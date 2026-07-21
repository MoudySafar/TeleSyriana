function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    department: row.department,
    employmentType: row.employment_type,
    hoursText: row.hours_text,
    payRate: row.pay_rate == null ? null : Number(row.pay_rate),
    currency: row.currency,
    positions: row.positions,
    description: row.description,
    requirements: row.requirements,
    status: row.status,
    closesAt: row.closes_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    applicantUserId: row.applicant_user_id,
    applicantName: row.applicant_name ?? null,
    applicantStaffCode: row.applicant_staff_code ?? null,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReferral(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    referredByUserId: row.referred_by_user_id,
    referredByName: row.referred_by_name ?? null,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    candidatePhone: row.candidate_phone,
    relationship: row.relationship,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createJobRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async listForProject({ projectId, status = "open", limit = 100 }) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
      const result = await db.query(
        `SELECT * FROM jobs
         WHERE project_id = $1
           AND ($2 = 'all' OR status = $2)
         ORDER BY updated_at DESC
         LIMIT $3`,
        [projectId, status, safeLimit],
      );
      return result.rows.map(mapJob);
    },

    async findJob({ projectId, jobId }) {
      const result = await db.query(
        `SELECT * FROM jobs
         WHERE project_id = $1 AND id = $2
         LIMIT 1`,
        [projectId, jobId],
      );
      return mapJob(result.rows[0]);
    },

    async createJob({
      id,
      projectId,
      title,
      department = null,
      employmentType = "full_time",
      hoursText = null,
      payRate = null,
      currency = null,
      positions = 1,
      description,
      requirements = null,
      status = "draft",
      closesAt = null,
      createdByUserId,
    }) {
      const result = await db.query(
        `INSERT INTO jobs (
           id, project_id, title, department, employment_type, hours_text,
           pay_rate, currency, positions, description, requirements, status,
           closes_at, created_by_user_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14
         ) RETURNING *`,
        [
          id,
          projectId,
          title,
          department,
          employmentType,
          hoursText,
          payRate,
          currency,
          positions,
          description,
          requirements,
          status,
          closesAt,
          createdByUserId,
        ],
      );
      return mapJob(result.rows[0]);
    },

    async updateJob({ projectId, jobId, fields }) {
      const result = await db.query(
        `UPDATE jobs
         SET title = COALESCE($3, title),
             department = COALESCE($4, department),
             employment_type = COALESCE($5, employment_type),
             hours_text = COALESCE($6, hours_text),
             pay_rate = COALESCE($7, pay_rate),
             currency = COALESCE($8, currency),
             positions = COALESCE($9, positions),
             description = COALESCE($10, description),
             requirements = COALESCE($11, requirements),
             status = COALESCE($12, status),
             closes_at = CASE WHEN $13::boolean THEN $14::timestamptz ELSE closes_at END,
             updated_at = NOW()
         WHERE project_id = $1 AND id = $2
         RETURNING *`,
        [
          projectId,
          jobId,
          fields.title ?? null,
          fields.department ?? null,
          fields.employmentType ?? null,
          fields.hoursText ?? null,
          fields.payRate ?? null,
          fields.currency ?? null,
          fields.positions ?? null,
          fields.description ?? null,
          fields.requirements ?? null,
          fields.status ?? null,
          Object.hasOwn(fields, "closesAt"),
          fields.closesAt ?? null,
        ],
      );
      return mapJob(result.rows[0]);
    },

    async createApplication({ id, jobId, applicantUserId, message = null }) {
      const result = await db.query(
        `WITH inserted AS (
           INSERT INTO job_applications (id, job_id, applicant_user_id, message)
           VALUES ($1, $2, $3, $4)
           RETURNING *
         )
         SELECT inserted.*,
                u.display_name AS applicant_name,
                u.staff_code AS applicant_staff_code
         FROM inserted
         INNER JOIN users u ON u.id = inserted.applicant_user_id`,
        [id, jobId, applicantUserId, message],
      );
      return mapApplication(result.rows[0]);
    },

    async listApplications(jobId) {
      const result = await db.query(
        `SELECT a.*,
                u.display_name AS applicant_name,
                u.staff_code AS applicant_staff_code
         FROM job_applications a
         INNER JOIN users u ON u.id = a.applicant_user_id
         WHERE a.job_id = $1
         ORDER BY a.created_at ASC`,
        [jobId],
      );
      return result.rows.map(mapApplication);
    },

    async updateApplicationStatus({ applicationId, status }) {
      const result = await db.query(
        `WITH updated AS (
           UPDATE job_applications
           SET status = $2, updated_at = NOW()
           WHERE id = $1
           RETURNING *
         )
         SELECT updated.*,
                u.display_name AS applicant_name,
                u.staff_code AS applicant_staff_code
         FROM updated
         INNER JOIN users u ON u.id = updated.applicant_user_id`,
        [applicationId, status],
      );
      return mapApplication(result.rows[0]);
    },

    async createReferral({
      id,
      jobId,
      referredByUserId,
      candidateName,
      candidateEmail = null,
      candidatePhone = null,
      relationship = null,
      notes = null,
    }) {
      const result = await db.query(
        `WITH inserted AS (
           INSERT INTO job_referrals (
             id, job_id, referred_by_user_id, candidate_name,
             candidate_email, candidate_phone, relationship, notes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *
         )
         SELECT inserted.*, u.display_name AS referred_by_name
         FROM inserted
         INNER JOIN users u ON u.id = inserted.referred_by_user_id`,
        [
          id,
          jobId,
          referredByUserId,
          candidateName,
          candidateEmail,
          candidatePhone,
          relationship,
          notes,
        ],
      );
      return mapReferral(result.rows[0]);
    },

    async listReferrals(jobId) {
      const result = await db.query(
        `SELECT r.*, u.display_name AS referred_by_name
         FROM job_referrals r
         INNER JOIN users u ON u.id = r.referred_by_user_id
         WHERE r.job_id = $1
         ORDER BY r.created_at ASC`,
        [jobId],
      );
      return result.rows.map(mapReferral);
    },

    async updateReferralStatus({ referralId, status }) {
      const result = await db.query(
        `WITH updated AS (
           UPDATE job_referrals
           SET status = $2, updated_at = NOW()
           WHERE id = $1
           RETURNING *
         )
         SELECT updated.*, u.display_name AS referred_by_name
         FROM updated
         INNER JOIN users u ON u.id = updated.referred_by_user_id`,
        [referralId, status],
      );
      return mapReferral(result.rows[0]);
    },
  };
}
