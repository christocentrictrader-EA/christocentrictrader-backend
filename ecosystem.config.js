// PM2 ecosystem config
// Usage:  pm2 start ecosystem.config.js
//         pm2 save && pm2 startup

module.exports = {
  apps: [{
    name        : 'christocentrictrader',
    script      : 'server.js',
    cwd         : '/var/www/christocentrictrader/backend',
    instances   : 1,
    autorestart : true,
    watch       : false,
    max_memory_restart: '256M',
    env_production: {
      NODE_ENV : 'production',
      PORT     : 3000,
    },
    error_file  : '/var/log/cct/err.log',
    out_file    : '/var/log/cct/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
