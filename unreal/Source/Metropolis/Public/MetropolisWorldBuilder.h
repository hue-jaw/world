// ============================================================================
// METROPOLIS — MetropolisWorldBuilder
// Construit un quartier de démonstration JOUABLE sans aucun asset importé.
//
// Pourquoi : un .umap ne peut être produit que par l'éditeur. Plutôt que de
// livrer un projet qui s'ouvre sur une scène vide (ou de prétendre qu'une
// carte existe), le GameMode génère à l'exécution la géométrie minimale :
// sol, chaussées, trottoirs PHYSIQUES (StreetSurfaceActor), îlots, bâtiments.
//
// C'est un greybox de validation : il prouve que le graphe routier, la voirie
// franchissable, la météo et le HUD fonctionnent. Il n'a pas vocation à
// remplacer les assets définitifs (Poly Haven / Blueprints) — voir
// Documentation/02_EDITOR_STEPS.md.
//
// Tous les meshes utilisés sont des primitives MOTEUR (/Engine/BasicShapes),
// donc toujours présentes dans une installation Launcher.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MetropolisWorldBuilder.generated.h"

class URoadNetworkSubsystem;
class UStaticMesh;
class UStaticMeshComponent;

UCLASS()
class METROPOLIS_API AMetropolisWorldBuilder : public AActor
{
	GENERATED_BODY()

public:
	AMetropolisWorldBuilder();

	/** Construit le quartier autour du graphe routier fourni. */
	UFUNCTION(BlueprintCallable, Category = "Quartier")
	void BuildDistrict(URoadNetworkSubsystem* Network);

	/** Hauteur des bâtiments, en centimètres. */
	UPROPERTY(EditAnywhere, Category = "Quartier")
	FVector2D BuildingHeightRange = FVector2D(900.f, 3600.f);

	/** Largeur de chaussée totale (cm). */
	UPROPERTY(EditAnywhere, Category = "Quartier")
	float RoadWidth = 900.f;

	/** Largeur du trottoir (cm). */
	UPROPERTY(EditAnywhere, Category = "Quartier")
	float SidewalkWidth = 320.f;

	/** Nombre de voitures garées décoratives par pâté de maisons. */
	UPROPERTY(EditAnywhere, Category = "Quartier")
	int32 ParkedCarsPerBlock = 2;

	/** Graine aléatoire : le même plan est reproduit à chaque lancement. */
	UPROPERTY(EditAnywhere, Category = "Quartier")
	int32 Seed = 1337;

private:
	/** Cube moteur 100 cm, pivot au centre. */
	UPROPERTY()
	TObjectPtr<UStaticMesh> CubeMesh;

	void LoadMeshes();
	void BuildGround(const FBox2D& Bounds);
	void BuildRoads(URoadNetworkSubsystem* Network);
	void BuildSidewalks(URoadNetworkSubsystem* Network);
	void BuildBuildings(const FBox2D& Bounds, float BlockSpacing);
	void BuildParkedCars(const FBox2D& Bounds, float BlockSpacing);

	/** Ajoute un cube (géométrie + collision) au monde. */
	void SpawnBox(const FVector& Center, const FVector& HalfExtent, const FRotator& Rotation);

	FRandomStream Random;
	int32 BoxesSpawned = 0;
};
