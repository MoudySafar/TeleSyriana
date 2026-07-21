import test from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_ROLES, PROJECT_ROLES } from "../src/core/access-control.js";
import { createJobService } from "../src/jobs/job-service.js";

function fakeRepositories() {
  const users = new Map([
    ["hr", { id: "hr", displayName: "HR", platformRole: PLATFORM_ROLES.HR, status: "active" }],
    ["manager", { id: "manager", displayName: "Manager", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["supervisor", { id: "supervisor", displayName: "Supervisor", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
    ["agent", { id: "agent", displayName: "Agent", platformRole: PLATFORM_ROLES.MEMBER, status: "active" }],
  ]);
  const memberships = [
    { userId: "manager", projectId: "ipro", role: PROJECT_ROLES.MANAGER, status: "active" },
    { userId: "supervisor", projectId: "ipro", role: PROJECT_ROLES.SUPERVISOR, status: "active" },
    { userId: "agent", projectId: "ipro", role: PROJECT_ROLES.AGENT, status: "active" },
  ];
  const jobs = [];
  const applications = [];
  const referrals = [];
  const audit = [];

  const repo = {
    users: {
      async findById(id) { return users.get(id) ?? null; },
    },
    memberships: {
      async listForUser(userId) { return memberships.filter((item) => item.userId === userId); },
    },
    audit: {
      async append(event) { audit.push(event); return event; },
    },
    jobs: {
      async listForProject({ projectId, status }) {
        return jobs.filter((job) => job.projectId === projectId && (status === "all" || job.status === status));
      },
      async findJob({ projectId, jobId }) {
        return jobs.find((job) => job.projectId === projectId && job.id === jobId) ?? null;
      },
      async createJob(input) {
        const job = { ...input, createdAt: "now", updatedAt: "now" };
        jobs.push(job);
        return job;
      },
      async updateJob({ projectId, jobId, fields }) {
        const job = jobs.find((item) => item.projectId === projectId && item.id === jobId);
        Object.assign(job, fields);
        return { ...job };
      },
      async createApplication({ id, jobId, applicantUserId, message }) {
        if (applications.some((item) => item.jobId === jobId && item.applicantUserId === applicantUserId)) {
          const error = new Error("duplicate application");
          error.code = "23505";
          throw error;
        }
        const application = { id, jobId, applicantUserId, message, status: "new" };
        applications.push(application);
        return application;
      },
      async listApplications(jobId) { return applications.filter((item) => item.jobId === jobId); },
      async updateApplicationStatus({ applicationId, status }) {
        const application = applications.find((item) => item.id === applicationId);
        application.status = status;
        return { ...application };
      },
      async createReferral(input) {
        const referral = { ...input, status: "new" };
        referrals.push(referral);
        return referral;
      },
      async listReferrals(jobId) { return referrals.filter((item) => item.jobId === jobId); },
      async updateReferralStatus({ referralId, status }) {
        const referral = referrals.find((item) => item.id === referralId);
        referral.status = status;
        return { ...referral };
      },
    },
  };

  return { repo, state: { jobs, applications, referrals, audit } };
}

function serviceWith(repo) {
  return createJobService({
    pool: {},
    runInTransaction: async (_pool, work) => work({}),
    repositoryFactory: () => repo,
    clock: () => new Date("2026-07-21T18:00:00Z"),
  });
}

async function seedOpenJob(service, actorId = "manager") {
  return service.create({
    actorId,
    projectId: "ipro",
    input: {
      title: "Customer Support Agent",
      description: "Support iPro customers through TeleSyriana and Gmail.",
      status: "open",
      employmentType: "full_time",
      positions: 2,
    },
  });
}

test("HR can create a job inside iPro without becoming an iPro ticket/chat member", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  const job = await seedOpenJob(service, "hr");

  assert.equal(job.projectId, "ipro");
  assert.equal(job.status, "open");
  assert.equal(job.title, "Customer Support Agent");
});

test("Project Manager can create and manage iPro jobs", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);
  const job = await seedOpenJob(service, "manager");

  const updated = await service.update({
    actorId: "manager",
    projectId: "ipro",
    jobId: job.id,
    fields: { status: "closed" },
  });

  assert.equal(updated.status, "closed");
  assert.equal(state.audit.at(-1).action, "jobs.posting_updated");
});

test("Supervisor cannot create job posting but can apply to an open opportunity", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);
  const job = await seedOpenJob(service);

  await assert.rejects(
    service.create({
      actorId: "supervisor",
      projectId: "ipro",
      input: { title: "Unauthorized", description: "No" },
    }),
    (error) => error.code === "FORBIDDEN",
  );

  const application = await service.apply({
    actorId: "supervisor",
    projectId: "ipro",
    jobId: job.id,
    message: "I would like to move into this role.",
  });
  assert.equal(application.applicantUserId, "supervisor");
  assert.equal(application.status, "new");
});

test("Agent can refer a candidate to an open iPro job", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);
  const job = await seedOpenJob(service);

  const referral = await service.refer({
    actorId: "agent",
    projectId: "ipro",
    jobId: job.id,
    input: {
      candidateName: "Candidate One",
      candidateEmail: "Candidate@Example.com",
      relationship: "Former colleague",
    },
  });

  assert.equal(referral.referredByUserId, "agent");
  assert.equal(referral.candidateEmail, "candidate@example.com");
});

test("Agent requesting all jobs still receives open opportunities only", async () => {
  const { repo, state } = fakeRepositories();
  const service = serviceWith(repo);
  await seedOpenJob(service);
  state.jobs.push({
    id: "job:draft",
    projectId: "ipro",
    title: "Draft Role",
    description: "Hidden",
    status: "draft",
  });

  const jobs = await service.list({ actorId: "agent", projectId: "ipro", status: "all" });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "open");
});

test("Agent cannot use iPro Jobs permission to access another project", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);

  await assert.rejects(
    service.list({ actorId: "agent", projectId: "kiddio", status: "open" }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("closed jobs reject new applications and referrals", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);
  const job = await seedOpenJob(service);
  await service.update({ actorId: "manager", projectId: "ipro", jobId: job.id, fields: { status: "closed" } });

  await assert.rejects(
    service.apply({ actorId: "agent", projectId: "ipro", jobId: job.id }),
    (error) => error.code === "CONFLICT",
  );
  await assert.rejects(
    service.refer({
      actorId: "agent",
      projectId: "ipro",
      jobId: job.id,
      input: { candidateName: "Candidate" },
    }),
    (error) => error.code === "CONFLICT",
  );
});

test("HR/Manager pipeline can advance applications and referrals", async () => {
  const { repo } = fakeRepositories();
  const service = serviceWith(repo);
  const job = await seedOpenJob(service);
  const application = await service.apply({ actorId: "agent", projectId: "ipro", jobId: job.id });
  const referral = await service.refer({
    actorId: "supervisor",
    projectId: "ipro",
    jobId: job.id,
    input: { candidateName: "External Candidate" },
  });

  const appUpdated = await service.updateApplicationStatus({
    actorId: "hr",
    projectId: "ipro",
    jobId: job.id,
    applicationId: application.id,
    status: "interview",
  });
  const referralUpdated = await service.updateReferralStatus({
    actorId: "manager",
    projectId: "ipro",
    jobId: job.id,
    referralId: referral.id,
    status: "under_review",
  });

  assert.equal(appUpdated.status, "interview");
  assert.equal(referralUpdated.status, "under_review");
});
