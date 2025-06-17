const TwoCaptcha = require('2captcha');
const fs = require('fs');

async function testSimpleCaptcha() {
    console.log('🧪 Testing simple CAPTCHA submission...');
    
    const apiKey = '2946675bf95f4081c1941d7a5f4141b6';
    const solver = new TwoCaptcha.Solver(apiKey);
    
    try {
        // Test with a simple known working image first
        console.log('📊 Checking balance...');
        const balance = await solver.balance();
        console.log(`💰 Balance: $${balance}`);
        
        // Create a simple test image (1x1 pixel PNG)
        const simpleTestImage = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width: 1
            0x00, 0x00, 0x00, 0x01, // height: 1
            0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
            0x90, 0x77, 0x53, 0xDE, // CRC
            0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
            0x49, 0x44, 0x41, 0x54, // IDAT
            0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, // compressed data
            0x02, 0x00, 0x01, 0xE2, // CRC
            0x00, 0x00, 0x00, 0x00, // IEND chunk length
            0x49, 0x45, 0x4E, 0x44, // IEND
            0xAE, 0x42, 0x60, 0x82  // CRC
        ]);
        
        console.log('🧪 Testing with minimal PNG...');
        try {
            const testResult = await solver.imageCaptcha({
                buffer: simpleTestImage,
                timeout: 30000
            });
            console.log('✅ Simple test worked:', testResult.data);
        } catch (error) {
            console.log('❌ Simple test failed:', error.message);
        }
        
        // Now test with our actual CAPTCHA if it exists
        if (fs.existsSync('captcha-debug.png')) {
            console.log('\n🧪 Testing with actual CAPTCHA...');
            const actualImage = fs.readFileSync('captcha-debug.png');
            
            // Try with different parameters
            const attempts = [
                { buffer: actualImage, timeout: 60000 },
                { body: actualImage.toString('base64'), timeout: 60000 },
                { path: 'captcha-debug.png', timeout: 60000 }
            ];
            
            for (let i = 0; i < attempts.length; i++) {
                try {
                    console.log(`🔄 Attempt ${i + 1}: ${Object.keys(attempts[i])[0]} method`);
                    const result = await solver.imageCaptcha(attempts[i]);
                    console.log(`✅ Success with method ${i + 1}: "${result.data}"`);
                    break;
                } catch (error) {
                    console.log(`❌ Method ${i + 1} failed: ${error.message}`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testSimpleCaptcha();