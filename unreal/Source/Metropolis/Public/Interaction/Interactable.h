#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "Interactable.generated.h"

/**
 * Interface generique d'interaction (brief section 14).
 * Tout objet interactif du monde (vehicule, porte, distributeur, pompe...)
 * implemente cette interface ; le personnage ne connait que l'interface,
 * jamais la classe concrete. Miroir du systeme d'interaction du prototype web.
 */
UINTERFACE(MinimalAPI, Blueprintable)
class UInteractable : public UInterface
{
	GENERATED_BODY()
};

class METROPOLIS_API IInteractable
{
	GENERATED_BODY()

public:
	/** Texte affiche dans le prompt contextuel (ex. "Entrer dans le vehicule"). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Metropolis|Interaction")
	FText GetInteractionPrompt(APawn* Interactor) const;

	/** Execute l'interaction. Retourne true si consommee. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Metropolis|Interaction")
	bool Interact(APawn* Interactor);

	/** Distance max d'interaction (cm). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Metropolis|Interaction")
	float GetInteractionRange() const;
};
