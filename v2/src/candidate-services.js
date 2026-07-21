import { createAuditLogService } from "./audit/audit-log-service.js";
import { createAuthRepository } from "./auth/auth-repository.js";
import { createAuthenticationService } from "./auth/auth-service.js";
import { createChatService } from "./chat/chat-service.js";
import { checkDatabaseHealth } from "./db/postgres.js";
import { createRepositories } from "./db/repositories.js";
import { createEmployeeDirectoryService } from "./employees/employee-directory-service.js";
import { createPersistentEmployeeService } from "./employees/persistent-employee-service.js";
import { createShopifyIntegrationService } from "./integrations/shopify-service.js";
import { createJobService } from "./jobs/job-service.js";
import { createShopifyOrderService } from "./orders/shopify-order-service.js";
import { createProfileService } from "./profile/profile-service.js";
import { createProjectAdminService } from "./projects/project-admin-service.js";
import { createProjectService } from "./projects/project-service.js";
import { createWorkspaceService } from "./projects/workspace-service.js";
import { createTeamService } from "./teams/team-service.js";
import { createTicketAssignmentService } from "./tickets/ticket-assignment-service.js";
import { createTicketQueueService } from "./tickets/ticket-queue-service.js";
import { createTicketService } from "./tickets/ticket-service.js";

export function createCandidateServices(pool) {
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
    workspace: createWorkspaceService({
      projects: repositories.projects,
      memberships: repositories.memberships,
    }),
    employees: createPersistentEmployeeService({ pool }),
    employeeDirectory: createEmployeeDirectoryService({ pool }),
    teams: createTeamService({ pool }),
    profile: createProfileService({ pool }),
    integrations,
    orders: createShopifyOrderService({ repositories, integrations }),
    tickets: createTicketService({ pool }),
    ticketQueue: createTicketQueueService({ pool }),
    ticketAssignment: createTicketAssignmentService({ pool }),
    chat: createChatService({ pool }),
    jobs: createJobService({ pool }),
    auditLog: createAuditLogService({ pool }),
    healthCheck: () => checkDatabaseHealth(pool),
  };
}
