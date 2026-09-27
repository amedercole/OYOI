export type SupplierOrderResult = {
  ok: boolean;
  mocked: true;
  confirmationNumber: string;
  steps: string[];
};

/** Supplier ordering isn't wired to a real storefront yet, so orders get a mock confirmation. */
export async function placeSupplierOrder(input: {
  supplier: string;
  productName: string;
  quantity: number;
  unit?: string;
  sku?: string;
}): Promise<SupplierOrderResult> {
  const confirmationNumber = `CB-${Date.now().toString().slice(-8)}`;
  console.log("[orders:mock] placing order", input, "→", confirmationNumber);
  return {
    ok: true,
    mocked: true,
    confirmationNumber,
    steps: [
      `Ordered ${input.quantity}${input.unit ? ` ${input.unit}` : ""} of ${input.productName}${input.sku ? ` (SKU ${input.sku})` : ""} from ${input.supplier}`,
      `Confirmation ${confirmationNumber}`,
    ],
  };
}
