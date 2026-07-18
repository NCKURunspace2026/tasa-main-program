import { forwardRef } from "react";
import "./PageHeader.css";

const PageHeader = forwardRef(function PageHeader(
  {
    eyebrow = "Mission Dashboard",
    title,
    description,
    scenarioId,
    scenarioOptions = [],
    onScenarioChange,
    className = "",
    children,
  },
  ref,
) {
  const hasScenarioSelector = Boolean(
    scenarioId && onScenarioChange && scenarioOptions.length > 0,
  );

  return (
    <header
      ref={ref}
      className={`page-header ${className}`.trim()}
    >
      <div className="page-header-title-group">
        <p className="page-header-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>

        {description ? (
          <p className="page-header-description">{description}</p>
        ) : null}
      </div>

      {hasScenarioSelector ? (
        <div className="page-header-scenario-field">
          <label htmlFor={`${title.toLowerCase()}-scenario`}>
            Scenario
          </label>

          <select
            id={`${title.toLowerCase()}-scenario`}
            value={scenarioId}
            onChange={onScenarioChange}
          >
            {scenarioOptions.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {children ? (
        <div className="page-header-actions">{children}</div>
      ) : null}
    </header>
  );
});

export default PageHeader;
