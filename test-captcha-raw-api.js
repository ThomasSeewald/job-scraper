const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function testRawCaptchaAPI() {
    console.log('🧪 Testing 2captcha raw HTTP API...');
    
    const apiKey = '2946675bf95f4081c1941d7a5f4141b6';
    const baseURL = 'http://2captcha.com';
    
    try {
        // Test balance first
        console.log('📊 Checking balance via raw API...');
        const balanceResponse = await axios.get(`${baseURL}/res.php`, {
            params: {
                key: apiKey,
                action: 'getbalance'
            }
        });
        console.log(`💰 Balance: $${balanceResponse.data}`);
        
        if (!fs.existsSync('captcha-debug.png')) {
            console.log('❌ CAPTCHA debug image not found');
            return;
        }
        
        // Submit CAPTCHA
        console.log('🧩 Submitting CAPTCHA via raw API...');
        
        const formData = new FormData();
        formData.append('key', apiKey);
        formData.append('method', 'post');
        formData.append('file', fs.createReadStream('captcha-debug.png'));
        
        const submitResponse = await axios.post(`${baseURL}/in.php`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Content-Type': 'multipart/form-data'
            }
        });
        
        console.log('📤 Submit response:', submitResponse.data);
        
        if (submitResponse.data.startsWith('OK|')) {
            const captchaId = submitResponse.data.split('|')[1];
            console.log(`✅ CAPTCHA submitted with ID: ${captchaId}`);
            
            // Poll for result
            console.log('⏳ Waiting for solution...');
            let attempts = 0;
            const maxAttempts = 30; // 1 minute max
            
            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                attempts++;
                
                const resultResponse = await axios.get(`${baseURL}/res.php`, {
                    params: {
                        key: apiKey,
                        action: 'get',
                        id: captchaId
                    }
                });
                
                console.log(`🔄 Attempt ${attempts}: ${resultResponse.data}`);
                
                if (resultResponse.data === 'CAPCHA_NOT_READY') {
                    continue;
                } else if (resultResponse.data.startsWith('OK|')) {
                    const solution = resultResponse.data.split('|')[1];
                    console.log(`✅ CAPTCHA solved: "${solution}"`);
                    return solution;
                } else {
                    console.log(`❌ Error: ${resultResponse.data}`);
                    break;
                }
            }
            
            console.log('⏰ Timeout waiting for solution');
        } else {
            console.log(`❌ Submit failed: ${submitResponse.data}`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

testRawCaptchaAPI();