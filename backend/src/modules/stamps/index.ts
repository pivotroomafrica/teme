// Public API of the stamps module. Other modules may import only from here.
export { StampsModule } from './stamps.module';
export { StampsRepository, type StampRecord } from './infrastructure/stamps.repository';
export { progressFor, completesCard, type Progress } from './domain/stamp-progress';
export { CardAccessService, type CardAccess } from './application/card-access.service';
export { MESSAGES, REJECTION_REASONS, type RejectionReason } from './domain/scan-policy';
