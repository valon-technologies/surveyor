import Database from 'better-sqlite3';
const db = new Database('surveyor.db');

// ALL distinct statuses in the DB including not_applicable etc
const allStatuses = db.prepare(`
  SELECT fm.status, COUNT(*) as cnt
  FROM field_mapping fm
  WHERE fm.is_latest = 1
  GROUP BY fm.status
`).all();
console.log('All statuses across all entities:', JSON.stringify(allStatuses, null, 2));
