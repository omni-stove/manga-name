# Code rules

A JSDoc or docblock states behavior: what the function does, its inputs and outputs, how it is used. A README states what the package is for, where its spec lives, and only the steps to run it that no script, task, config or workflow carries: machine setup, secrets, a procedure spanning several commands. Commands live in `package.json` scripts and `.mise/tasks.toml`, ports, budgets and schedules in their configs and workflows; a README points there instead of copying them. Every other comment states only why the straightforward alternative was not taken, or the constraint that binds the code. Delete a comment or README passage that restates the implementation, a script, a config or a workflow, also in files you did not write.

Change a generated file by changing its source and regenerating it.
