"""Module 8: Comment and Reaction Management (`UC-5.1..5.6`, `UC-5.8`).

Owns: `comments` (soft deletion, `parent_comment_id` per M-002),
`comment_edit_histories` (preserves `previous_is_spoiler` per M-003),
and `comment_reactions` (atomic desired-state `LIKE`/`DISLIKE` counters).
"""

from enum import StrEnum


class CommentReactionType(StrEnum):
    LIKE = "LIKE"
    DISLIKE = "DISLIKE"


__all__ = ["CommentReactionType"]
