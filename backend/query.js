const { Pool } = require('pg');
const pool = new Pool({
  user: 'vapi_user',
  host: '212.56.33.91',
  database: 'vapi_agent_db',
  password: 'vapi_secure_password',
  port: 5432,
});
pool.query('SELECT name, fishaudio_api_key FROM agents').then(res => {
  console.log(res.rows);
  process.exit(0);
}).catch(console.error);
