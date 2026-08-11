# OpenPost

OpenPost coordinates authored content, durable work, and delivery across connected social destinations.

## Language

**Job**:
A durable unit of work that OpenPost can recover after process interruption and drive to a terminal or recurring outcome.
_Avoid_: Task, background task

**Publication**:
The canonical user-visible post aggregate. It owns authored intent, revision, schedule, and one or more destination renditions.
_Avoid_: Post record, campaign

**Rendition**:
One destination-specific form of a Publication, bound to a connected social account and output profile.
_Avoid_: Variant, cross-post
