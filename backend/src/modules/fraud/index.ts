// Public API of the fraud module. Other modules may import only from here.
export { FraudModule } from './fraud.module';
export { FraudEvaluationService } from './application/fraud-evaluation.service';
export { FraudJobs } from './application/fraud-jobs';
export {
  DEFAULT_THRESHOLDS,
  mergeThresholds,
  type FraudThresholds,
} from './domain/fraud-thresholds';
