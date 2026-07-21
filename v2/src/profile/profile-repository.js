export function createProfileRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A database client with query(sql, params) is required");
  }

  return {
    async updatePreferences({ userId, locale, theme }) {
      const result = await db.query(
        `UPDATE users
         SET locale = $2,
             theme = $3,
             updated_at = NOW()
         WHERE id = $1 AND status = 'active'
         RETURNING id, staff_code, display_name, email, platform_role, status, locale, theme, updated_at`,
        [userId, locale, theme],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        staffCode: row.staff_code,
        displayName: row.display_name,
        email: row.email,
        platformRole: row.platform_role,
        status: row.status,
        locale: row.locale,
        theme: row.theme,
        updatedAt: row.updated_at,
      };
    },
  };
}
