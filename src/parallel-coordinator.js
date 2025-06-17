const BatchAllocator = require('./batch-allocator');
const WorkerWithBatch = require('./worker-with-batch');

class ParallelCoordinator {
    constructor(options = {}) {
        this.numWorkers = options.numWorkers || 5;
        this.domainsPerWorker = options.domainsPerWorker || 10;
        this.headless = options.headless !== false;
    }

    async run() {
        console.log('=== PARALLEL KEYWORD SCRAPING WITH NO DUPLICATION ===');
        console.log(`Configuration: ${this.numWorkers} workers, ${this.domainsPerWorker} domains each`);
        
        const startTime = Date.now();
        
        try {
            // Step 1: Pre-allocate domains to eliminate duplication
            console.log('\n1️⃣ Allocating domains to workers...');
            const batches = await BatchAllocator.allocateDomainBatches(this.numWorkers, this.domainsPerWorker);
            
            if (batches.length === 0) {
                console.log('No domains available for processing!');
                return;
            }
            
            console.log(`✅ Allocated ${batches.length} batches`);
            
            // Step 2: Start all workers in parallel with their assigned batches
            console.log('\n2️⃣ Starting workers...');
            const workerPromises = batches.map(batch => {
                const worker = new WorkerWithBatch(batch.workerId, batch.domains, {
                    headless: this.headless
                });
                return worker.run();
            });
            
            // Step 3: Wait for all workers to complete
            console.log('\n3️⃣ Processing domains in parallel...');
            const results = await Promise.allSettled(workerPromises);
            
            // Step 4: Aggregate results
            console.log('\n4️⃣ Aggregating results...');
            let totalProcessed = 0;
            let totalSuccessful = 0;
            let totalEmails = 0;
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    const { domainsProcessed, successful, totalEmails: emails } = result.value;
                    totalProcessed += domainsProcessed;
                    totalSuccessful += successful;
                    totalEmails += emails;
                    console.log(`Worker ${index + 1}: ${domainsProcessed} domains, ${emails} emails`);
                } else {
                    console.error(`Worker ${index + 1} failed:`, result.reason?.message);
                }
            });
            
            const duration = (Date.now() - startTime) / 1000;
            const rate = totalProcessed / (duration / 60); // domains per minute
            
            console.log('\n🎉 PARALLEL PROCESSING COMPLETE!');
            console.log(`📊 Results:`);
            console.log(`   • Total domains processed: ${totalProcessed}`);
            console.log(`   • Successful: ${totalSuccessful} (${((totalSuccessful/totalProcessed)*100).toFixed(1)}%)`);
            console.log(`   • Total emails found: ${totalEmails}`);
            console.log(`   • Average emails per domain: ${(totalEmails/totalProcessed).toFixed(2)}`);
            console.log(`   • Processing time: ${duration.toFixed(1)} seconds`);
            console.log(`   • Processing rate: ${rate.toFixed(1)} domains/minute`);
            
            // Estimate remaining time
            const remaining = await BatchAllocator.getRemainingCount();
            const remainingTime = remaining > 0 ? (remaining / rate).toFixed(1) : 0;
            console.log(`   • Domains remaining: ${remaining}`);
            console.log(`   • Estimated time to completion: ${remainingTime} minutes`);
            
        } catch (error) {
            console.error('Parallel processing failed:', error);
        }
    }
}

// CLI usage
if (require.main === module) {
    const numWorkers = parseInt(process.argv[2]) || 5;
    const domainsPerWorker = parseInt(process.argv[3]) || 10;
    const headless = process.env.HEADLESS_MODE !== 'false';
    
    const coordinator = new ParallelCoordinator({
        numWorkers,
        domainsPerWorker,
        headless
    });
    
    coordinator.run().catch(console.error);
}

module.exports = ParallelCoordinator;