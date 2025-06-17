const TwoCaptcha = require('2captcha');
const fs = require('fs');

async function testCaptchaFormats() {
    console.log('🧪 Testing different CAPTCHA submission formats...');
    
    const apiKey = process.env.CAPTCHA_API_KEY || '2946675bf95f4081c1941d7a5f4141b6';
    const solver = new TwoCaptcha.Solver(apiKey);
    
    // First, check if the saved image file exists
    const imagePath = 'captcha-debug.png';
    if (!fs.existsSync(imagePath)) {
        console.log('❌ CAPTCHA debug image not found. Run test-captcha-debug.js first.');
        return;
    }
    
    try {
        console.log('📊 Testing balance first...');
        const balance = await solver.balance();
        console.log(`💰 Account balance: $${balance}`);
        
        // Read the image file
        const imageBuffer = fs.readFileSync(imagePath);
        console.log(`📄 Image size: ${imageBuffer.length} bytes`);
        
        // Test 1: Using base64 string (current method)
        console.log('\n🧪 Test 1: Base64 string method');
        try {
            const result1 = await solver.imageCaptcha({
                body: imageBuffer.toString('base64'),
                timeout: 60000
            });
            console.log(`✅ Method 1 success: "${result1.data}"`);
        } catch (error) {
            console.log(`❌ Method 1 failed: ${error.message}`);
        }
        
        // Test 2: Using file path
        console.log('\n🧪 Test 2: File path method');
        try {
            const result2 = await solver.imageCaptcha({
                path: imagePath,
                timeout: 60000
            });
            console.log(`✅ Method 2 success: "${result2.data}"`);
        } catch (error) {
            console.log(`❌ Method 2 failed: ${error.message}`);
        }
        
        // Test 3: Using Buffer directly
        console.log('\n🧪 Test 3: Buffer method');
        try {
            const result3 = await solver.imageCaptcha({
                buffer: imageBuffer,
                timeout: 60000
            });
            console.log(`✅ Method 3 success: "${result3.data}"`);
        } catch (error) {
            console.log(`❌ Method 3 failed: ${error.message}`);
        }
        
        // Test 4: Check image format
        console.log('\n🔍 Image format analysis:');
        const imageHeader = imageBuffer.slice(0, 8);
        console.log('Image header (hex):', imageHeader.toString('hex'));
        console.log('Image header (ascii):', imageHeader.toString('ascii', 1, 4));
        
        // Check if it's a valid PNG
        const isPNG = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47;
        console.log('Valid PNG format:', isPNG);
        
        // Check dimensions from PNG header if it's PNG
        if (isPNG) {
            const width = imageBuffer.readUInt32BE(16);
            const height = imageBuffer.readUInt32BE(20);
            console.log(`PNG dimensions: ${width}x${height}`);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testCaptchaFormats();