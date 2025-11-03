import { pool } from '../db/pool';
import { runRuntimeValidator } from './runtimeValidator';

(async () => {
  try {
    console.log('Starting Runtime Validator...\n');

    // Get days from command line args (default: 1)
    const days = parseInt(process.argv[2]) || 1;

    const result = await runRuntimeValidator(pool, { days });

    console.log('\n✅ Validation complete');
    console.log(`Validated: ${result.validated} days`);
    console.log(`Discrepancies: ${result.discrepancies}`);
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Validation failed:', err.message);
    process.exit(1);
  }
})();
