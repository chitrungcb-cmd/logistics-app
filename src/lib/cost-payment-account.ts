type NamedAccount = { name: string } | null | undefined;

export function resolveCostPaymentAccount(cost: {
  paidFromCompanyAccount?: NamedAccount;
  paidBy?: NamedAccount;
}) {
  if (cost.paidFromCompanyAccount) {
    return {
      kind: "company" as const,
      name: cost.paidFromCompanyAccount.name,
      label: `TK công ty · ${cost.paidFromCompanyAccount.name}`,
    };
  }
  if (cost.paidBy) {
    return {
      kind: "personal" as const,
      name: cost.paidBy.name,
      label: `Cá nhân · ${cost.paidBy.name}`,
    };
  }
  return null;
}
