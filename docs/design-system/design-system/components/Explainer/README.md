# Explainer

Short plain-language answers to the questions voters actually ask, under the tracker; collapsed by default except the one most relevant to the current stage.

- **Consumer provides:** a list of question and answer pairs in the voter's language, and which one opens first.
- A `.vbt-card` of native `<details>` rows: 16px semibold question, `body` answer, `surface-sunk` behind the open row. Native details keep it keyboard and screen-reader accessible with no script.
- Answers are two sentences at most, about a 6th-grade reading level, written as a person would say them.
- Every voter screen ships in English and Spanish. Set `lang` on the container; Spanish runs about a third longer, so never fix heights.
- Open the question that matches the stage: "sealed" after casting, "challenged" on a challenged ballot.
