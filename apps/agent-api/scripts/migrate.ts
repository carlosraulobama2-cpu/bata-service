import { migrate } from './migrate-lib';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
migrate(url, (m) => console.log(m))
  .then((applied) => console.log(applied.length ? `Done (${applied.length} applied)` : 'Database is up to date'))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
