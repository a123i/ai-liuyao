// 在项目根目录运行。只创建新配置，绝不覆盖已有密钥。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env 已存在，已保留。修改配置后执行 docker compose up -d --build。');
  process.exit(0);
}
let config = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const key of ['ADMIN_TOKEN', 'MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD']) {
  config = config.replace(new RegExp('^' + key + '=$', 'm'), key + '=' + crypto.randomBytes(24).toString('hex'));
}
fs.writeFileSync(target, config, { mode: 0o600, flag: 'wx' });
console.log('已创建 .env：数据库密码及后台口令已随机生成。');
console.log('请在 .env 中填写 DEEPSEEK_API_KEY 和 SITE_ADDRESS，然后运行 docker compose up -d --build。');
