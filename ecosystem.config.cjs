module.exports = {
  apps: [{
    name: 'tour',
    script: 'src/index.js',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      STAFF_PIN: '1234'
    }
  }]
};
