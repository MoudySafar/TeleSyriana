import { randomUUID } from "node:crypto";

import { CAPABILITIES, hasCapability } from "../core/access-control.js";
import { withTransaction } from "../db/postgres.js";
import { createRepositories } from "../db/repositories.js";
import { createJobRepository } from "./job-repository.js";

const JOB_STATUSES = new Set(["draft", "open", "closed", "archived"]);
const PIPELINE_STATUSES = new Set([
  "new",
  "under_review",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);
const EMPLOYMENT_TYPES = new Set(["full_time", "part_time", "contract", "temporary"]);

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const error = new Error(`${name} is required`);
    error.code = "INVALID_INPUT";
    throw error;
  }
  return normalized;
}

function optionalText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function forbidden(message = "Jobs access denied") {
  const error = new Error(message);
  error.code = "FORBIDDEN";
  return error;
}

function notFound(entity) {
  const error = new Error(`${entity} not found`);
  error.code = "NOT_FOUND";
  return error;
}

function persistenceRepositories(db) {
  return {
    ...createRepositories(db),
    jobs: createJobRepository(db),
  };
}

async function actorContext(repositories, actorId, projectId) {
  const actor = await repositories.users.findById(actorId);
  if (!actor || actor.status !== "active") throw forbidden("Active employee account required");
  const memberships = await repositories.memberships.listForUser(actorId);
  return { actor, memberships };
}

function requireCapability({ actor, memberships, projectId, capability }) {
  if (!hasCapability({ user: actor, memberships, projectId, capability })) {
    throw forbidden();
  }
}

function ensureOpenJob(job, now = new Date()) {
  if (!job || job.status !== "open") {
    const error = new Error("This job is not open for applications or referrals");
    error.code = "CONFLICT";
    throw error;
  }
  if (job.closesAt && new Date(job.closesAt) <= now) {
    const error = new Error("This job opportunity has closed");
    error.code = "CONFLICT";
    throw error;
  }
}

export function createJobService({
  pool,
  runInTransaction = withTransaction,
  repositoryFactory = persistenceRepositories,
  clock = () => new Date(),
} = {}) {
  if (!pool) throw new TypeError("A database pool is required");

  const transaction = (work) =>
    runInTransaction(pool, async (db) => work(repositoryFactory(db)));

  return {
    async list({ actorId, projectId, status = "open", limit = 100 }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        const canManage = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.JOBS_MANAGE,
        });
        const canApply = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.JOBS_APPLY,
        });
        const canRefer = hasCapability({
          user: actor,
          memberships,
          projectId,
          capability: CAPABILITIES.JOBS_REFER,
        });
        if (!canManage && !canApply && !canRefer) throw forbidden();

        const requested = String(status || "open");
        const effectiveStatus = canManage ? requested : "open";
        if (effectiveStatus !== "all" && !JOB_STATUSES.has(effectiveStatus)) {
          const error = new Error(`Invalid job status filter: ${effectiveStatus}`);
          error.code = "INVALID_INPUT";
          throw error;
        }
        return repositories.jobs.listForProject({ projectId, status: effectiveStatus, limit });
      });
    },

    async create({ actorId, projectId, input = {} }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({
          actor,
          memberships,
          projectId,
          capability: CAPABILITIES.JOBS_CREATE,
        });

        const employmentType = String(input.employmentType || "full_time");
        if (!EMPLOYMENT_TYPES.has(employmentType)) {
          const error = new Error(`Invalid employment type: ${employmentType}`);
          error.code = "INVALID_INPUT";
          throw error;
        }
        const status = String(input.status || "draft");
        if (!JOB_STATUSES.has(status)) {
          const error = new Error(`Invalid job status: ${status}`);
          error.code = "INVALID_INPUT";
          throw error;
        }
        const positions = Number(input.positions || 1);
        if (!Number.isInteger(positions) || positions < 1) {
          const error = new Error("positions must be a positive integer");
          error.code = "INVALID_INPUT";
          throw error;
        }

        const job = await repositories.jobs.createJob({
          id: `job:${randomUUID()}`,
          projectId,
          title: requiredText(input.title, "title"),
          department: optionalText(input.department),
          employmentType,
          hoursText: optionalText(input.hoursText),
          payRate: input.payRate == null || input.payRate === "" ? null : Number(input.payRate),
          currency: optionalText(input.currency),
          positions,
          description: requiredText(input.description, "description"),
          requirements: optionalText(input.requirements),
          status,
          closesAt: input.closesAt || null,
          createdByUserId: actor.id,
        });

        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.posting_created",
          targetType: "job",
          targetId: job.id,
          metadata: { title: job.title, status: job.status },
        });
        return job;
      });
    },

    async update({ actorId, projectId, jobId, fields = {} }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_MANAGE });
        const current = await repositories.jobs.findJob({ projectId, jobId });
        if (!current) throw notFound("Job");

        if (fields.status != null && !JOB_STATUSES.has(String(fields.status))) {
          const error = new Error(`Invalid job status: ${fields.status}`);
          error.code = "INVALID_INPUT";
          throw error;
        }
        if (fields.employmentType != null && !EMPLOYMENT_TYPES.has(String(fields.employmentType))) {
          const error = new Error(`Invalid employment type: ${fields.employmentType}`);
          error.code = "INVALID_INPUT";
          throw error;
        }

        const updated = await repositories.jobs.updateJob({ projectId, jobId, fields });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.posting_updated",
          targetType: "job",
          targetId: jobId,
          metadata: { previousStatus: current.status, status: updated.status },
        });
        return updated;
      });
    },

    async apply({ actorId, projectId, jobId, message = null }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_APPLY });
        const job = await repositories.jobs.findJob({ projectId, jobId });
        if (!job) throw notFound("Job");
        ensureOpenJob(job, clock());

        const application = await repositories.jobs.createApplication({
          id: `application:${randomUUID()}`,
          jobId,
          applicantUserId: actor.id,
          message: optionalText(message),
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.application_submitted",
          targetType: "job_application",
          targetId: application.id,
          metadata: { jobId },
        });
        return application;
      });
    },

    async refer({ actorId, projectId, jobId, input = {} }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_REFER });
        const job = await repositories.jobs.findJob({ projectId, jobId });
        if (!job) throw notFound("Job");
        ensureOpenJob(job, clock());

        const referral = await repositories.jobs.createReferral({
          id: `referral:${randomUUID()}`,
          jobId,
          referredByUserId: actor.id,
          candidateName: requiredText(input.candidateName, "candidateName"),
          candidateEmail: optionalText(input.candidateEmail)?.toLowerCase() ?? null,
          candidatePhone: optionalText(input.candidatePhone),
          relationship: optionalText(input.relationship),
          notes: optionalText(input.notes),
        });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.referral_submitted",
          targetType: "job_referral",
          targetId: referral.id,
          metadata: { jobId, candidateName: referral.candidateName },
        });
        return referral;
      });
    },

    async pipeline({ actorId, projectId, jobId }) {
      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_MANAGE });
        const job = await repositories.jobs.findJob({ projectId, jobId });
        if (!job) throw notFound("Job");
        const [applications, referrals] = await Promise.all([
          repositories.jobs.listApplications(jobId),
          repositories.jobs.listReferrals(jobId),
        ]);
        return { job, applications, referrals };
      });
    },

    async updateApplicationStatus({ actorId, projectId, jobId, applicationId, status }) {
      const nextStatus = String(status || "");
      if (!PIPELINE_STATUSES.has(nextStatus)) {
        const error = new Error(`Invalid application status: ${nextStatus}`);
        error.code = "INVALID_INPUT";
        throw error;
      }

      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_MANAGE });
        const job = await repositories.jobs.findJob({ projectId, jobId });
        if (!job) throw notFound("Job");
        const applications = await repositories.jobs.listApplications(jobId);
        if (!applications.some((application) => application.id === applicationId)) {
          throw notFound("Job application");
        }

        const updated = await repositories.jobs.updateApplicationStatus({ applicationId, status: nextStatus });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.application_status_changed",
          targetType: "job_application",
          targetId: applicationId,
          metadata: { jobId, status: nextStatus },
        });
        return updated;
      });
    },

    async updateReferralStatus({ actorId, projectId, jobId, referralId, status }) {
      const nextStatus = String(status || "");
      if (!PIPELINE_STATUSES.has(nextStatus)) {
        const error = new Error(`Invalid referral status: ${nextStatus}`);
        error.code = "INVALID_INPUT";
        throw error;
      }

      return transaction(async (repositories) => {
        const { actor, memberships } = await actorContext(repositories, actorId, projectId);
        requireCapability({ actor, memberships, projectId, capability: CAPABILITIES.JOBS_MANAGE });
        const job = await repositories.jobs.findJob({ projectId, jobId });
        if (!job) throw notFound("Job");
        const referrals = await repositories.jobs.listReferrals(jobId);
        if (!referrals.some((referral) => referral.id === referralId)) {
          throw notFound("Job referral");
        }

        const updated = await repositories.jobs.updateReferralStatus({ referralId, status: nextStatus });
        await repositories.audit.append({
          actorUserId: actor.id,
          projectId,
          action: "jobs.referral_status_changed",
          targetType: "job_referral",
          targetId: referralId,
          metadata: { jobId, status: nextStatus },
        });
        return updated;
      });
    },
  };
}
