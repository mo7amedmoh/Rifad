const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function isValidCutoff(value) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-01$/.exec(value || '');
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toISOString().slice(0, 10) === value;
}

function pruneTickets({ databasePath, cutoffDate, confirmed }) {
  if (!isValidCutoff(cutoffDate)) {
    throw new Error('يجب تحديد حدّ حذف بصيغة YYYY-MM-01.');
  }
  if (!confirmed) {
    throw new Error('الحذف نهائي. أعد التشغيل مع --confirm بعد مراجعة حدّ الحذف.');
  }
  if (!fs.existsSync(databasePath)) {
    throw new Error(`قاعدة البيانات غير موجودة: ${databasePath}`);
  }

  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    const count = db.prepare(`SELECT COUNT(*) AS count FROM tickets
      WHERE created_at IS NOT NULL AND date(created_at) < date(?)`).get(cutoffDate).count;
    db.prepare(`DELETE FROM tickets
      WHERE created_at IS NOT NULL AND date(created_at) < date(?)`).run(cutoffDate);
    db.exec('COMMIT;');
    return count;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}

function main(args) {
  const cutoffArgument = args.find((argument) => argument.startsWith('--before='));
  const cutoffDate = cutoffArgument?.slice('--before='.length);
  const databasePath = path.resolve(process.env.DATABASE_PATH || './data/rifad.sqlite');
  const deleted = pruneTickets({
    databasePath,
    cutoffDate,
    confirmed: args.includes('--confirm')
  });
  console.log(`حُذف ${deleted} بلاغ قبل ${cutoffDate}.`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { isValidCutoff, pruneTickets };
