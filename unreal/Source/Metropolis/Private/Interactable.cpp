#include "Interaction/Interactable.h"
// Interface : implémentations par défaut définies ici pour que les Blueprints
// qui n'écrasent pas les événements natifs restent valides.
FText IInteractable::GetInteractionPrompt_Implementation(APawn* Interactor) const
{
	return FText::GetEmpty();
}

bool IInteractable::Interact_Implementation(APawn* Interactor)
{
	return false;
}

float IInteractable::GetInteractionRange_Implementation() const
{
	return 300.f;
}
