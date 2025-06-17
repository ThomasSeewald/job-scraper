const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

try {
    console.log('🔧 Testing interface startup...');
    
    // Test 1: Config loading
    console.log('1. Loading database config...');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config/database.json'), 'utf8'));
    console.log('✅ Config loaded');
    
    // Test 2: Database connection
    console.log('2. Testing database connection...');
    const pool = new Pool(config.production);
    
    pool.query('SELECT COUNT(*) FROM job_scrp_job_details WHERE best_email IS NOT NULL', (err, result) => {
        if (err) {
            console.log('❌ Database query failed:', err.message);
            process.exit(1);
        }
        
        console.log(`✅ Database connected. Found ${result.rows[0].count} jobs with emails`);
        
        // Test 3: Express app
        console.log('3. Testing Express app...');
        const app = express();
        
        app.use(express.json());
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, 'views'));
        
        // Test 4: Simple route
        app.get('/test', (req, res) => {
            res.json({ status: 'OK', timestamp: new Date() });
        });
        
        // Test 5: Main route with database
        app.get('/', async (req, res) => {
            try {
                const statsQuery = `
                    SELECT 
                        COUNT(*) as total_jobs,
                        COUNT(CASE WHEN jd.best_email IS NOT NULL THEN 1 END) as jobs_with_emails
                    FROM job_scrp_arbeitsagentur_jobs_v2 j
                    LEFT JOIN job_scrp_job_details jd ON j.refnr = jd.reference_number
                    WHERE j.is_active = true
                `;
                
                const stats = await pool.query(statsQuery);
                
                res.json({
                    message: 'Interface test successful',
                    stats: stats.rows[0]
                });
                
            } catch (error) {
                console.error('Route error:', error);
                res.status(500).json({ error: error.message });
            }
        });
        
        // Start server
        const server = app.listen(3001, () => {
            console.log('✅ Express server started on port 3001');
            console.log('🔗 Test URLs:');
            console.log('   http://localhost:3001/test');
            console.log('   http://localhost:3001/');
            
            // Auto-shutdown after 30 seconds for testing
            setTimeout(() => {
                console.log('🛑 Test completed, shutting down...');
                server.close();
                process.exit(0);
            }, 30000);
        });
        
        server.on('error', (error) => {
            console.log('❌ Server error:', error.message);
            process.exit(1);
        });
    });
    
} catch (error) {
    console.log('❌ Startup test failed:', error.message);
    console.log('Stack trace:', error.stack);
    process.exit(1);
}