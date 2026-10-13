// src/app/create-services.js
import { createAuthService } from './auth-service.js';
import { createCatalogService } from './catalog-service.js';
import { createConnectionService } from './connection-service.js';
import { createDiscoverService } from './discover-service.js';
import { publicConfig } from './config.js';
import { createGroupService } from './group-service.js';
import { createProfileService } from './profile-service.js';
import { createRepertoireService } from './repertoire-service.js';
import { createStatisticsService } from './statistics-service.js';
import { createRodaClient } from './supabase-client.js';
import { createTrainingService } from './training-service.js';
import {
  createE2EAuthService, createE2ECatalogService, createE2EConnectionService, createE2EDiscoverService,
  createE2EGroupService, createE2EProfileService, createE2ERepertoireService, createE2EStatisticsService,
  createE2ETrainingService,
} from './testing/fake-services.js';

export function createServices({ window, localMode }) {
  if (localMode) {
    return {
      auth: createE2EAuthService({ window }),
      profile: createE2EProfileService({ window }),
      group: createE2EGroupService({ window }),
      connection: createE2EConnectionService({ window }),
      training: createE2ETrainingService({ window }),
      statistics: createE2EStatisticsService({ window }),
      repertoire: createE2ERepertoireService({ window }),
      catalog: createE2ECatalogService({ window }),
      discover: createE2EDiscoverService({ window }),
    };
  }
  const client = createRodaClient(publicConfig);
  return {
    auth: createAuthService({ client, origin: window.location.origin, storage: window.localStorage }),
    profile: createProfileService(client),
    group: createGroupService(client),
    connection: createConnectionService(client),
    training: createTrainingService(client),
    statistics: createStatisticsService(client),
    repertoire: createRepertoireService(client),
    catalog: createCatalogService(client),
    discover: createDiscoverService(client),
  };
}
