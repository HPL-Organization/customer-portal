import type {
  AutoPayDatabase,
  AutoPaySupabase,
} from "@/lib/autopay/types";

type Tables = AutoPayDatabase["public"]["Tables"];

type Seed = {
  autopayment_queue_stock_change?: Tables["autopayment_queue_stock_change"]["Row"][];
  sales_order_invoice_line_links?: Tables["sales_order_invoice_line_links"]["Row"][];
  invoices?: Tables["invoices"]["Row"][];
  sales_orders?: Tables["sales_orders"]["Row"][];
  payment_instruments?: Tables["payment_instruments"]["Row"][];
  customer_information?: Tables["customer_information"]["Row"][];
  profiles?: Tables["profiles"]["Row"][];
};

type TableName = keyof Tables;
type TableRow<T extends TableName> = Tables[T]["Row"];
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; value: unknown[] }
  | { type: "is"; column: string; value: null }
  | { type: "not"; column: string; op: string; value: unknown }
  | { type: "lte"; column: string; value: unknown };

type Order = Array<{ column: string; ascending: boolean }>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function matchesFilter(row: Record<string, unknown>, filter: Filter) {
  const value = row[filter.column];
  switch (filter.type) {
    case "eq":
      return value === filter.value;
    case "in":
      return filter.value.includes(value);
    case "is":
      return value === filter.value;
    case "not":
      if (filter.op === "is") return value !== filter.value;
      return true;
    case "lte":
      if (typeof value === "number" && typeof filter.value === "number") {
        return value <= filter.value;
      }
      return String(value ?? "") <= String(filter.value ?? "");
  }
}

function applyFilters<T extends Record<string, unknown>>(rows: T[], filters: Filter[]) {
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function applyOrder<T extends Record<string, unknown>>(rows: T[], orders: Order) {
  if (!orders.length) return rows;
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const av = a[order.column];
      const bv = b[order.column];
      if (av == null && bv == null) continue;
      if (av == null) return order.ascending ? -1 : 1;
      if (bv == null) return order.ascending ? 1 : -1;
      if (av < bv) return order.ascending ? -1 : 1;
      if (av > bv) return order.ascending ? 1 : -1;
    }
    return 0;
  });
}

class SelectQuery<T extends TableName> implements PromiseLike<{ data: TableRow<T>[]; error: null }> {
  private filters: Filter[] = [];
  private currentOrder: Order = [];

  constructor(
    private readonly rows: TableRow<T>[],
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: "in", column, value });
    return this;
  }

  is(column: string, value: null) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  not(column: string, op: string, value: unknown) {
    this.filters.push({ type: "not", column, op, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.currentOrder.push({ column, ascending: options.ascending });
    return this;
  }

  then<TResult1 = { data: TableRow<T>[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: TableRow<T>[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    const filtered = applyFilters(this.rows as Record<string, unknown>[], this.filters);
    const ordered = applyOrder(filtered, this.currentOrder);
    return {
      data: clone(ordered) as TableRow<T>[],
      error: null,
    };
  }
}

class UpdateQuery<T extends TableName> implements PromiseLike<{ data: null; error: null }> {
  private filters: Filter[] = [];

  constructor(
    private readonly rows: TableRow<T>[],
    private readonly values: Partial<TableRow<T>>,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return Promise.resolve(this.execute());
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ type: "in", column, value });
    return Promise.resolve(this.execute());
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    const matched = applyFilters(this.rows as Record<string, unknown>[], this.filters);
    for (const row of matched) {
      Object.assign(row, clone(this.values));
    }
    return { data: null, error: null };
  }
}

export function createInMemoryAutoPaySupabase(seed: Seed = {}) {
  const tables: { [K in TableName]: TableRow<K>[] } = {
    autopayment_queue_stock_change: clone(seed.autopayment_queue_stock_change || []),
    sales_order_invoice_line_links: clone(seed.sales_order_invoice_line_links || []),
    invoices: clone(seed.invoices || []),
    sales_orders: clone(seed.sales_orders || []),
    payment_instruments: clone(seed.payment_instruments || []),
    customer_information: clone(seed.customer_information || []),
    profiles: clone(seed.profiles || []),
  };

  const client = {
    from<T extends TableName>(table: T) {
      return {
        select(_columns: string) {
          return new SelectQuery(tableData(table));
        },
        update(values: Partial<TableRow<T>>) {
          return new UpdateQuery(tableData(table), values);
        },
      };
    },
  } as unknown as AutoPaySupabase;

  function tableData<T extends TableName>(table: T) {
    return tables[table];
  }

  return {
    client,
    tables,
  };
}
