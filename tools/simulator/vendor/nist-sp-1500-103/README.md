# NIST SP 1500-103 CVR schema (trimmed)

`cvr-minimal.schema.json` is cut from the official NIST SP 1500-103 JSON schema, `NIST_V0_cast_vote_records.json` in https://github.com/usnistgov/CastVoteRecords (commit `ca637b6173127fecd2e8d9401d72a7bc0e78a654`, file sha256 `f1b037e6303450b451dcf5c7a0db2ab025c5869376242ed772cb4f05b1944e89`). Source URL: https://raw.githubusercontent.com/usnistgov/CastVoteRecords/master/NIST_V0_cast_vote_records.json

The tests use it to check written CVR files with AJV, independently of the simulator's own validator.

How it was trimmed. Nothing was loosened:

- Kept these object definitions, copied as-is: `CastVoteRecordReport`, `CVR`, `CVRSnapshot`, `CVRContest`, `CVRContestSelection`, `SelectionPosition`, `Election`, `GpUnit`, `ReportingDevice`, `Candidate`, `CandidateContest`, `CandidateSelection`, `BallotMeasureContest`, `BallotMeasureSelection`. Also kept every enum definition they reference.
- Removed each property whose type is an object definition that wasn't kept (for example `Code`, `Party`, `BallotImage`, `Annotation`, `CVRWriteIn`, `FractionalVotes`). Every definition keeps `additionalProperties: false`, so those properties are now rejected rather than allowed.
- Removed the `oneOf` alternatives for contest and selection types that weren't kept (`Contest`, `PartyContest`, `RetentionContest`, `ContestSelection`, `PartySelection`).
- Changed `$schema` from draft-04 to draft-07 so AJV 8 loads it. The schema only uses keywords that mean the same in both drafts (`type`, `enum`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `oneOf`, `$ref`, `pattern`, `format`). Also added a `$comment` that points here.
- Kept NIST's non-standard `refTypes` annotation. The test registers it as an annotation-only keyword. Id references are checked by `validateCvrReport`.

`cvr-sample.json` is a hand-written report, made without the simulator, that the schema must accept. It shows the schema test isn't just mirroring the emitter.
