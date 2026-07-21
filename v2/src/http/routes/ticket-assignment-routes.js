import express from "express";

export function createTicketAssignmentRouter({ ticketAssignment }) {
  if (!ticketAssignment) throw new TypeError("Ticket assignment service is required");

  const router = express.Router({ mergeParams: true });

  router.patch("/:ticketCode/assignment", async (req, res) => {
    const ticket = await ticketAssignment.assign({
      actorId: req.auth.user.id,
      projectId: req.params.projectId,
      ticketCode: req.params.ticketCode,
      assignedToUserId: req.body?.assignedToUserId ?? null,
      assignedTeamId: req.body?.assignedTeamId ?? null,
      expectedVersion: req.body?.expectedVersion ?? null,
    });
    res.json({ success: true, ticket });
  });

  return router;
}
