const ParallelCoordinator = require('./src/parallel-coordinator');

// Test with 1 worker and 3 domains
async function testParallelWithCookies() {
    const coordinator = new ParallelCoordinator({
        numWorkers: 1,
        domainsPerWorker: 3,
        headless: false  // Visible to see cookie handling
    });
    
    await coordinator.run();
}

testParallelWithCookies().catch(console.error);