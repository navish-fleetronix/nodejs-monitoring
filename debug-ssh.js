const { NodeSSH } = require('node-ssh');
const fs = require('fs');

const serverConfig = {
  host: 'receiver.test.pro.fleetronix.io',  // Replace with your server
  port: 22,
  username: 'ubuntu',
  privateKeyPath: 'C:/Users/Navish/.ssh/id_rsa'  // Replace with your actual path
};

async function testSSH() {
  console.log('Testing SSH connection...');
  console.log('Key path:', serverConfig.privateKeyPath);
  
  // Check if key file exists
  if (!fs.existsSync(serverConfig.privateKeyPath)) {
    console.error('❌ Key file does not exist!');
    console.log('Please check:');
    console.log('1. Run: dir C:\\Users\\%USERNAME%\\.ssh\\');
    console.log('2. Update path in script');
    return;
  }
  
  console.log('✅ Key file exists');
  
  const ssh = new NodeSSH();
  
  try {
    await ssh.connect({
      host: serverConfig.host,
      port: serverConfig.port,
      username: serverConfig.username,
      privateKeyPath: serverConfig.privateKeyPath,
      readyTimeout: 30000,
      debug: (message) => console.log('SSH Debug:', message)
    });
    
    console.log('✅ SSH Connected!');
    
    const result = await ssh.execCommand('hostname && uptime');
    console.log('Output:', result.stdout);
    
    ssh.dispose();
  } catch (error) {
    console.error('❌ SSH Error:', error.message);
    console.error('Full error:', error);
  }
}

testSSH();