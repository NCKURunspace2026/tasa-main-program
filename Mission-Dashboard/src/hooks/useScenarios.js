import { useEffect, useMemo, useState } from "react";

import { getScenarios } from "../services/api.js";

const fallbackScenarios = [
  {
    scenarioId: "SC-001",
    name: "LEO Interception",
    description: "",
    definition: {},
    isActive: true,
  },
  {
    scenarioId: "SC-002",
    name: "Orbital Rendezvous",
    description: "",
    definition: {},
    isActive: true,
  },
];

export default function useScenarios() {
  const [scenarios, setScenarios] = useState(fallbackScenarios);
  const [scenarioError, setScenarioError] = useState("");
  const [scenariosLoaded, setScenariosLoaded] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    getScenarios()
      .then((result) => {
        if (isCurrent) {
          if (result.items.length > 0) setScenarios(result.items);
          setScenarioError("");
          setScenariosLoaded(true);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setScenarioError(error.message);
          setScenariosLoaded(true);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  const scenarioOptions = useMemo(
    () => scenarios.map((scenario) => ({
      id: scenario.scenarioId,
      label: `${scenario.scenarioId}: ${scenario.name}`,
      description: scenario.description,
      definition: scenario.definition,
    })),
    [scenarios],
  );

  return {
    scenarios,
    scenarioOptions,
    scenarioError,
    scenariosLoaded,
  };
}
