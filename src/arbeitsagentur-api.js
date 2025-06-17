const axios = require('axios');
const JobDetailScraper = require('./job-detail-scraper');

class ArbeitsagenturAPI {
    constructor() {
        this.baseURL = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
        this.clientId = 'jobboerse-jobsuche';
        this.headers = {
            'X-API-Key': this.clientId,
            'User-Agent': 'jobboerse-jobsuche',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        this.scraper = new JobDetailScraper();
    }

    /**
     * Search jobs using the official Arbeitsagentur API
     * @param {Object} params - Search parameters
     * @returns {Promise<Object>} - Job search results
     */
    async searchJobs(params = {}) {
        try {
            const searchParams = {
                angebotsart: params.jobType || 1, // 1 = Jobs, 2 = Training  
                was: params.title || '', // Job title
                wo: params.location || '', // Location
                umkreis: params.radius || 25, // Radius in km
                size: params.limit || 50, // Results per page
                page: Math.max(params.page || 1, 1), // Page number (starts from 1)
                ...params
            };

            const response = await axios.get(`${this.baseURL}/pc/v4/jobs`, {
                headers: this.headers,
                params: searchParams,
                timeout: 30000
            });

            return {
                success: true,
                data: response.data,
                totalResults: response.data.maxergebnisse || 0,
                jobs: response.data.stellenangebote || [],
                currentPage: searchParams.page,
                resultsPerPage: searchParams.size
            };

        } catch (error) {
            console.error('Arbeitsagentur API Error:', error.message);
            return {
                success: false,
                error: error.message,
                data: null
            };
        }
    }

    /**
     * Get company logo by hash ID
     * @param {string} hashId - Company hash ID from job listing
     * @returns {Promise<string>} - Logo URL or null
     */
    async getCompanyLogo(hashId) {
        if (!hashId) return null;
        
        try {
            const logoUrl = `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/ed/v1/arbeitgeberlogo/${hashId}`;
            
            // Test if logo exists
            const response = await axios.head(logoUrl, {
                headers: this.headers,
                timeout: 5000
            });

            return response.status === 200 ? logoUrl : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Enhanced job search with additional processing
     * @param {Object} searchCriteria - Search parameters
     * @returns {Promise<Object>} - Processed job results
     */
    async enhancedJobSearch(searchCriteria) {
        const result = await this.searchJobs(searchCriteria);
        
        if (!result.success) {
            return result;
        }

        // Process and enhance job data
        const enhancedJobs = await Promise.all(
            result.jobs.map(async (job) => {
                const logoUrl = await this.getCompanyLogo(job.arbeitgeberHashId);
                
                return {
                    referenceNumber: job.refnr,
                    title: job.titel,
                    employer: job.arbeitgeber,
                    location: {
                        city: job.arbeitsort?.ort,
                        postalCode: job.arbeitsort?.plz,
                        region: job.arbeitsort?.region,
                        coordinates: job.arbeitsort?.koordinaten
                    },
                    occupation: job.beruf,
                    publicationDate: job.aktuelleVeroeffentlichungsdatum,
                    modificationDate: job.modifikationsTimestamp,
                    entryDate: job.eintrittsdatum,
                    externalUrl: job.externeUrl,
                    employerHashId: job.arbeitgeberHashId,
                    logoUrl: logoUrl,
                    source: 'arbeitsagentur_api',
                    fetchedAt: new Date().toISOString()
                };
            })
        );

        return {
            ...result,
            jobs: enhancedJobs
        };
    }

    /**
     * Get job statistics from the API
     * @param {Object} criteria - Search criteria for statistics
     * @returns {Promise<Object>} - Statistics data
     */
    async getJobStatistics(criteria = {}) {
        const result = await this.searchJobs({ ...criteria, size: 1 });
        
        if (!result.success) {
            return { total: 0, error: result.error };
        }

        return {
            total: result.totalResults,
            searchCriteria: criteria,
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Get detailed job information by scraping the job detail page
     * @param {string} referenceNumber - Job reference number
     * @param {boolean} showBrowser - Whether to show the browser window
     * @returns {Promise<Object>} - Detailed job information
     */
    async getJobDetails(referenceNumber, showBrowser = false) {
        try {
            console.log(`🔍 Getting detailed info for job: ${referenceNumber} (showBrowser: ${showBrowser})`);
            const details = await this.scraper.scrapeJobDetails(referenceNumber, showBrowser);
            return {
                success: true,
                data: details
            };
        } catch (error) {
            console.error(`❌ Failed to get job details for ${referenceNumber}:`, error.message);
            return {
                success: false,
                error: error.message,
                referenceNumber
            };
        }
    }

    /**
     * Enhanced job search with detailed information for selected jobs
     * @param {Object} searchCriteria - Search parameters
     * @param {boolean} includeDetails - Whether to scrape detailed info
     * @param {number} detailLimit - Max number of jobs to get details for
     * @returns {Promise<Object>} - Enhanced job results
     */
    async enhancedJobSearchWithDetails(searchCriteria, includeDetails = false, detailLimit = 5) {
        const searchResult = await this.enhancedJobSearch(searchCriteria);
        
        if (!searchResult.success || !includeDetails) {
            return searchResult;
        }

        console.log(`📋 Getting detailed info for ${Math.min(searchResult.jobs.length, detailLimit)} jobs...`);
        
        // Get detailed info for the first few jobs
        const jobsToDetail = searchResult.jobs.slice(0, detailLimit);
        const detailedJobs = [];

        for (let i = 0; i < jobsToDetail.length; i++) {
            const job = jobsToDetail[i];
            console.log(`🔍 Getting details for job ${i + 1}/${jobsToDetail.length}: ${job.referenceNumber}`);
            
            try {
                const detailResult = await this.getJobDetails(job.referenceNumber);
                
                if (detailResult.success) {
                    // Merge API data with scraped details
                    const enhancedJob = {
                        ...job,
                        details: detailResult.data,
                        hasDetailedInfo: true
                    };
                    detailedJobs.push(enhancedJob);
                } else {
                    // Keep original job data if scraping failed
                    detailedJobs.push({
                        ...job,
                        hasDetailedInfo: false,
                        detailError: detailResult.error
                    });
                }

                // Add delay between requests
                if (i < jobsToDetail.length - 1) {
                    await this.delay(2000);
                }

            } catch (error) {
                console.error(`❌ Error processing job ${job.referenceNumber}:`, error.message);
                detailedJobs.push({
                    ...job,
                    hasDetailedInfo: false,
                    detailError: error.message
                });
            }
        }

        // Add remaining jobs without details
        const remainingJobs = searchResult.jobs.slice(detailLimit);
        
        return {
            ...searchResult,
            jobs: [...detailedJobs, ...remainingJobs],
            detailedCount: detailedJobs.filter(job => job.hasDetailedInfo).length,
            totalJobs: searchResult.jobs.length
        };
    }

    /**
     * Utility function for delays
     * @param {number} ms - Milliseconds to wait
     */
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Validate search parameters
     * @param {Object} params - Parameters to validate
     * @returns {Object} - Validation result
     */
    validateSearchParams(params) {
        const errors = [];
        
        if (params.radius && (params.radius < 0 || params.radius > 200)) {
            errors.push('Radius must be between 0 and 200 km');
        }
        
        if (params.size && (params.size < 1 || params.size > 100)) {
            errors.push('Result size must be between 1 and 100');
        }
        
        if (params.page && params.page < 0) {
            errors.push('Page number must be 0 or greater');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    /**
     * View job in browser without scraping
     * @param {string} referenceNumber - Job reference number
     * @returns {Promise<Object>} - Result
     */
    async viewJobInBrowser(referenceNumber) {
        try {
            console.log(`👀 Opening job ${referenceNumber} in browser...`);
            
            const scraper = new JobDetailScraper();
            await scraper.initialize(false); // Always show browser
            
            const url = `https://www.arbeitsagentur.de/jobsuche/jobdetail/${referenceNumber}`;
            await scraper.page.goto(url, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });
            
            // Keep browser open for 30 seconds
            console.log('⏰ Browser will stay open for 30 seconds...');
            await this.delay(30000);
            
            await scraper.cleanup();
            
            return {
                success: true,
                message: 'Job opened in browser',
                referenceNumber,
                url
            };
            
        } catch (error) {
            console.error(`❌ Failed to view job ${referenceNumber}:`, error.message);
            return {
                success: false,
                error: error.message,
                referenceNumber
            };
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.scraper.cleanup();
    }
}

module.exports = ArbeitsagenturAPI;