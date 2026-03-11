Usage
// Charger une grammar depuis JSON au runtime
const json = await fetch("grammar-fr.json").then(r => r.json());
behavior.setRuntimeGrammar(McpGrammar.fromJSON(json));

// Inspecter la grammar effective
const effective = behavior.getEffectiveGrammar();
console.log(effective.toJSON());
