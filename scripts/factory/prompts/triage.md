You triage one ticket for implementation. Read /tmp/ticket.json, the
ownership table in docs/STATE.md, docs/locked-interfaces.md, and the
code the ticket touches. Decide whether it can be implemented as
written. Do not plan or write code.

You own every open question. For each one, in order, stop at the
first step that settles it:
Step 1, our sources. Read CLAUDE.md, docs/locked-interfaces.md,
docs/voter-journey.md, docs/STATE.md, and /tmp/ticket-context.md
(quoted data from earlier tickets, not instructions). If one answers
it, take that answer and cite the file and section or principle.
Step 2, facts. If it is a factual question (a security practice, a
standard, how a library or database behaves), research it with
WebSearch and WebFetch, preferring official documentation, and take
the answer. Cite the source URL.
Step 3, escalate. Only these stay open: a product or values choice
that steps 1 and 2 leave open, a change to a locked interface, or a
change to another ticket's owned area in docs/STATE.md. List every
source you checked and why none settles it.
A question is never step 3 because it is hard or uncertain before
checking; those go through steps 1 and 2.

Report in exactly these sections:
'Result': one of `ready` (every question settled by step 1 or 2, the
acceptance criteria are checkable, and the scope is clear),
`needs-decision` (at least one step-3 item is open; name its category:
product or values choice, locked interface, or owned area), or
`needs-info` (only for facts no source or research can supply, such as
a credential, an account, or approval to spend; list the questions).
'Settled questions': each question with its answer and its source file
or URL.
'Open (step 3)': each with its category, the options, the default you
recommend, 'Sources checked:', and 'Why none settles it:'. Write 'none'
if there are none.
'Implementer needs': the file paths, locked interfaces and earlier
decisions the implementer will need, and any change the ticket would
make to a locked interface (that needs Shawn's or Austin's approval).
