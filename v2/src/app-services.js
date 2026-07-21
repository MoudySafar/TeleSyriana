import { createAuthRepository } from "./auth/auth-repository.js";
import { createAuthenticationService } from "./auth/auth-service.js";
import { createChatService } from "./chat/chat-service.js";
import { checkDatabaseHealth } from "./db/postgres.js";
import { createRepositories } from "./db/repositories.js";
import { createPersistentEmployeeService } from "./employees/persistent-employee-service.js";
import { createShopifyIntegrationService } from "./integrations/shopify-service.js";
import { createJobService } from "./jobs/job-service.js";
import { createShopifyOrderService } from "./orders/shopify-order-service.js";
import { createProjectAdminService } from "./projects/project-admin-service.js";
import { createProjectService } from "./projects/project-service.js";
import { createTeamService } from "./teams/team-service.js";
import { createTicketQueueService } from "./tickets/ticket-queue-service.js";
import { createTicketService } from "./tickets/ticket-service.js";

export function createApplicationServices(pool) {
  if (!pool) throw new TypeError("A database pool is required");

  const repositories = createRepositories(pool);
  const authRepository = createAuthRepository(pool);
  const authentication = createAuthenticationService({
    users: repositories.users,
    auth: authRepository,
  });
  const integrations = createShopifyIntegrationService({ pool });

  return {
    authentication,
    projects: createProjectService({
      projects: repositories.projects,
      memberships: repositories.memberships,
    }),
    projectAdmin: createProjectAdminService({ pool }),
    employees: createPersistentEmployeeService({ pool }),
    teams: createTeamService({ pool }),
    integrations,
    orders: createShopifyOrderService({ repositories, integrations }),
    tickets: createTicketService({ pool }),
    ticketQueue: createTicketQueueService({ pool }),
    chat: createChatService({ pool }),
    jobs: createJobService({ pool }),
    healthCheck: () => checkDatabaseHealth(pool),
  };
}
