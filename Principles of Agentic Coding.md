Principles of Agentic Coding
1. Agentic programs include two distinct functions. Deterministic functions that are pure code where outputs are perfectly mapped to inputs and Agentic functions, which use LLM's to decide on outputs.
2. Deterministic functions are faster and cheaper. 
3. Agents whose output will be used in deterministic functions need to be given clear instructions on the format needed.
4. When possible design functions that can accept non-JSON outputs from agents. JSON enforcement creates additional characters and unnecessary complexity and risk to agent outputs.
5. The best case scenario for an agent is to give it context, clarity on output needs, but little instruction about how to arrive at the output. 
6. The code base is the world in which the agent inhabits. The agent should be given the rules of that world when iteracting. 
7. There are two types of agents, direct LLM calls with context, and agentic loops where the agent is given a set of tools and an open ended objective. 
8. Agentic loops can perform novel functions not prescribed by the core loop of the tool. However, once it's done, it is likely possible that function can be replicated with a single LLM call with the right context and clearly constructed request for output.
9. In other words, agentic loops should lead to functions that create direct calls with context and specific output requests and deterministic code that can replicate the previous agentic function. 
10. Studying several direct call functions for repeated behaviors, should create more deterministic loops as well. Meaning we should be able to turn single call LLM functions with context into deterministic code over time. 
11. During testing, include an LLM output log in your repo. The log should show the output from every call, using duplication, along with where it was invoked and it's exact context payload. This file should be gitignored. Logging should not occur in production.

