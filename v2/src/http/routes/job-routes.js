import express from "express";

export function createJobRouter({ jobs }) {
  if (!jobs) throw new TypeError("Jobs service is required");

  const router = express.Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const opportunities = await jobs.list({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      status: req.query.status || "open",
      limit: req.query.limit,
    });
    res.json({ success: true, jobs: opportunities });
  });

  router.post("/", async (req, res) => {
    const job = await jobs.create({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, job });
  });

  router.patch("/:jobId", async (req, res) => {
    const job = await jobs.update({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      fields: req.body || {},
    });
    res.json({ success: true, job });
  });

  router.post("/:jobId/apply", async (req, res) => {
    const application = await jobs.apply({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      message: req.body?.message,
    });
    res.status(201).json({ success: true, application });
  });

  router.post("/:jobId/refer", async (req, res) => {
    const referral = await jobs.refer({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      input: req.body || {},
    });
    res.status(201).json({ success: true, referral });
  });

  router.get("/:jobId/pipeline", async (req, res) => {
    const pipeline = await jobs.pipeline({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
    });
    res.json({ success: true, ...pipeline });
  });

  router.patch("/:jobId/applications/:applicationId/status", async (req, res) => {
    const application = await jobs.updateApplicationStatus({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      applicationId: req.params.applicationId,
      status: req.body?.status,
    });
    res.json({ success: true, application });
  });

  router.patch("/:jobId/referrals/:referralId/status", async (req, res) => {
    const referral = await jobs.updateReferralStatus({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      jobId: req.params.jobId,
      referralId: req.params.referralId,
      status: req.body?.status,
    });
    res.json({ success: true, referral });
  });

  return router;
}
