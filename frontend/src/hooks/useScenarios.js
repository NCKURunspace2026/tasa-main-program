import { useEffect, useMemo, useState } from "react";

import { getScenarios } from "../services/api.js";

export default function useScenarios() {
  const [scenarios, setScenarios] = useState([]);
  const [scenarioError, setScenarioError] = useState("");
  const [scenariosLoaded, setScenariosLoaded] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    getScenarios()
      .then((result) => {
        if (isCurrent) {
          setScenarios(result.items);
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
      scenarioJson: scenario.scenarioJson,
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
