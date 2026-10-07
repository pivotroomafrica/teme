// Public API of the tenancy module. Other modules may import only from here.
export * from './domain/actor';
export {
  CurrentActor,
  CurrentMerchantActor,
  CurrentPlatformActor,
  type RequestWithActor,
} from './api/current-actor.decorator';
