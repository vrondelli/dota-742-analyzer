export const ROLE_IMPACT_KEYS = Object.freeze(['offlane', 'soft-support', 'hard-support']);
export const IMPACT_RATINGS = Object.freeze(['Little direct contribution', 'Conditional', 'Reliable', 'Defining']);

export function prepareImpactRubric(role, priority = '') {
  const { key, headline, criteria } = role;
  if (priority && !criteria.some((criterion) => criterion.key === priority)) {
    throw new RangeError('Select a priority for the chosen role.');
  }
  const multipliers = criteria.map(({ key: criterionKey, weight }) => weight * (criterionKey === priority ? 2 : 1));
  const total = multipliers.reduce((sum, weight) => sum + weight, 0);
  return {
    key, headline, priority,
    criteria: criteria.map((criterion, index) => ({
      ...criterion,
      defaultWeight: criterion.weight,
      weight: multipliers[index] / total * 100,
    })),
    ratingLabels: IMPACT_RATINGS,
  };
}

function milestonePurchase(key, build, reason) {
  const step = build.steps.find((entry) => entry.key === key);
  if (step) return { ...step, reason, shortfall: step.affordable === false ? step.cumulativeCost - build.budget : null };
  const wasReplaced = build.change?.replaces?.key === key;
  return { key, reason, name: wasReplaced ? build.change.replaces.name : null,
    replaced: wasReplaced ? build.change.item.name : null };
}

export function scoreRoleImpact(rubric, profile, plan) {
  const ratings = rubric.criteria.map(({ key, label, weight }) => {
    const rating = profile.ratings[key];
    if (!rating || !Number.isInteger(rating.value) || rating.value < 0 || rating.value > 3) {
      throw new Error(`Missing impact rating ${key} for hero ${profile.heroId}.`);
    }
    return { key, label, weight, ...rating, contribution: rating.value * weight / 3 };
  });
  const milestones = Object.fromEntries(plan.builds.map((build) => {
    const key = profile.milestones[build.key];
    return [build.key, milestonePurchase(key, build, profile.milestoneReasons?.[build.key] ?? null)];
  }));
  return { score: ratings.reduce((sum, { contribution }) => sum + contribution, 0), ratings, milestones, sources: profile.sources ?? [] };
}
