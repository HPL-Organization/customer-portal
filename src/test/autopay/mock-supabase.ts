export function createUpdateSupabaseMock() {
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ column: string; value: unknown }>;
  }> = [];

  return {
    client: {
      from(table: string) {
        return {
          update(values: Record<string, unknown>) {
            const entry = {
              table,
              values,
              filters: [] as Array<{ column: string; value: unknown }>,
            };
            updates.push(entry);
            return {
              async eq(column: string, value: unknown) {
                entry.filters.push({ column, value });
                return { error: null };
              },
            };
          },
        };
      },
    },
    updates,
  };
}
