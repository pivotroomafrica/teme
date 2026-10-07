// Public API of the rewards module. Other modules may import only from here.
export { RewardsModule } from './rewards.module';
export { RewardsService, type RewardView, type RewardSummary } from './application/rewards.service';
export {
  rewardsEarned,
  canReverseStamp,
  deriveRewards,
  type RewardState,
} from './domain/reward-state';
