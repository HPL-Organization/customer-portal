import { describe, expect, it } from "vitest";
import {
  buildAutoPayQueueRowsForCommittedIncrease,
  buildSalesOrderLineKey,
  type ExistingSalesOrderLine,
  type IncomingSalesOrderLine,
} from "../build-queue-rows-from-committed-changes";

function makeExistingLine(
  overrides: Partial<ExistingSalesOrderLine> = {},
): ExistingSalesOrderLine {
  return {
    so_id: 1001,
    ns_line_id: 55,
    line_no: 1,
    quantity_committed: 1,
    ...overrides,
  };
}

function makeIncomingLine(
  overrides: Partial<IncomingSalesOrderLine> = {},
): IncomingSalesOrderLine {
  return {
    so_id: 1001,
    ns_line_id: 55,
    line_no: 1,
    quantity_committed: 3,
    is_closed: false,
    rate: 125.5,
    quantity: 5,
    amount: 627.5,
    item_id: 7001,
    item_sku: "SKU-55",
    item_display_name: "Blue Stone",
    ...overrides,
  };
}

describe("buildAutoPayQueueRowsForCommittedIncrease", () => {
  it("queue creation: creates a pending row when committed quantity increases", () => {
    const existing = makeExistingLine({ quantity_committed: 1 });
    const incoming = makeIncomingLine({ quantity_committed: 3, rate: 10 });

    const result = buildAutoPayQueueRowsForCommittedIncrease({
      lineRows: [incoming],
      existingLinesByKey: new Map([
        [buildSalesOrderLineKey(1001, 55, 1), existing],
      ]),
      existingPendingQueueKeys: new Set(),
    });

    expect(result).toEqual([
      {
        so_id: 1001,
        ns_line_id: 55,
        line_no: 1,
        item_id: 7001,
        item_sku: "SKU-55",
        item_display_name: "Blue Stone",
        quantity: 5,
        rate: 10,
        line_amount: 627.5,
        previous_quantity_committed: 1,
        new_quantity_committed: 3,
        committed_delta: 2,
        charge_amount: 20,
        status: "pending",
      },
    ]);
  });

  it("queue skip: does not create a row when committed quantity is unchanged or lower", () => {
    const existingLinesByKey = new Map([
      [buildSalesOrderLineKey(1001, 55, 1), makeExistingLine({ quantity_committed: 3 })],
      [buildSalesOrderLineKey(1002, 56, 1), makeExistingLine({ so_id: 1002, ns_line_id: 56, quantity_committed: 3 })],
    ]);

    const result = buildAutoPayQueueRowsForCommittedIncrease({
      lineRows: [
        makeIncomingLine({ so_id: 1001, ns_line_id: 55, quantity_committed: 3 }),
        makeIncomingLine({ so_id: 1002, ns_line_id: 56, quantity_committed: 2 }),
      ],
      existingLinesByKey,
      existingPendingQueueKeys: new Set(),
    });

    expect(result).toEqual([]);
  });

  it("queue skip: ignores rows already present as pending queue entries", () => {
    const result = buildAutoPayQueueRowsForCommittedIncrease({
      lineRows: [makeIncomingLine({ so_id: 1001, ns_line_id: 55, quantity_committed: 3 })],
      existingLinesByKey: new Map([
        [buildSalesOrderLineKey(1001, 55, 1), makeExistingLine({ quantity_committed: 1 })],
      ]),
      existingPendingQueueKeys: new Set(["1001::55::3"]),
    });

    expect(result).toEqual([]);
  });

  it("queue skip: ignores closed lines and rows without an existing baseline line", () => {
    const result = buildAutoPayQueueRowsForCommittedIncrease({
      lineRows: [
        makeIncomingLine({ is_closed: true }),
        makeIncomingLine({ so_id: 1002, ns_line_id: 66, line_no: 2 }),
      ],
      existingLinesByKey: new Map([
        [buildSalesOrderLineKey(1001, 55, 1), makeExistingLine()],
      ]),
      existingPendingQueueKeys: new Set(),
    });

    expect(result).toEqual([]);
  });

  it("queue dedupe: only creates one row for repeated entries in the same run", () => {
    const incoming = makeIncomingLine({ quantity_committed: 4, rate: 12.3456 });

    const result = buildAutoPayQueueRowsForCommittedIncrease({
      lineRows: [incoming, incoming],
      existingLinesByKey: new Map([
        [buildSalesOrderLineKey(1001, 55, 1), makeExistingLine({ quantity_committed: 1 })],
      ]),
      existingPendingQueueKeys: new Set(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        new_quantity_committed: 4,
        committed_delta: 3,
        charge_amount: 37.0368,
      }),
    );
  });
});
