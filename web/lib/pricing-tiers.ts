// The paid plans on /pricing, sold through Paddle. Edit names, text and features here.
//
// priceId: Paddle live price IDs (Paddle > Catalog > Prices). Prices, currencies and country
// prices come from Paddle, never from this file.
// planId: optional link to a plan with the same id in Admin > theOovi plans. When that plan
// exists, its monthly credits and daily limit are listed under the features too.

export interface Tier {
  name: "Starter" | "Pro" | "Advanced";
  description: string;
  features: string[];
  priceId: { month: string; year: string };
  planId?: string;
  /** Highlighted card. */
  featured?: boolean;
}

export const TIERS: Tier[] = [
  {
    name: "Starter",
    description: "For getting real work done with theOovi every day.",
    features: ["theOovi credits every month", "All oovi features", "Email support"],
    priceId: { month: "pri_01m70s1ry8d38s7r08sep7hzj6", year: "pri_01m70s1s73vx5k4dqptehnzmbq" },
    planId: "starter",
  },
  {
    name: "Pro",
    description: "For people who run their work with a team of bots.",
    features: ["More theOovi credits every month", "All oovi features", "Priority support"],
    priceId: { month: "pri_01m70s1sd33hacce2zjmesmp69", year: "pri_01m70s1sr7bjdhas3erk3abqn7" },
    planId: "pro",
    featured: true,
  },
  {
    name: "Advanced",
    description: "For heavy use across many groups and long tasks.",
    features: ["The most theOovi credits every month", "All oovi features", "Priority support"],
    priceId: { month: "pri_01m70s1t6eav18ftcjj9myxqe6", year: "pri_01m70s1tcjd2tdea182dkamwdc" },
    planId: "advanced",
  },
];
