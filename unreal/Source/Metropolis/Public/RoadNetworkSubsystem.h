// ============================================================================
// METROPOLIS — RoadNetworkSubsystem
// Graphe routier + recherche d'itinéraire (A*).
//
// Équivalent du RoadNetwork de la version WebGL, réimplémenté côté moteur :
//  - nœuds/arêtes avec sens uniques, limitations, classes de voie ;
//  - coût = temps de parcours (+ pénalité de virage, + congestion) ;
//  - fermetures dynamiques (travaux, accident) exclues du calcul ;
//  - index spatial pour trouver le nœud le plus proche d'une position.
//
// Ce sous-système ne connaît NI le joueur NI l'UI : il expose des fonctions
// pures, testables et appelables depuis Blueprint.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "MetropolisTypes.h"
#include "RoadNetworkSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FRoadNetworkChanged);

UCLASS(BlueprintType)
class METROPOLIS_API URoadNetworkSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	// --- Cycle de vie -------------------------------------------------------
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	/** Construit une grille régulière (district de démonstration). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	void BuildGrid(int32 SizeX, int32 SizeY, float Spacing = 6400.f, float SpeedLimit = 1390.f);

	/** Ajoute un tronçon bidirectionnel entre deux positions (crée les nœuds). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	int32 AddRoad(const FVector& From, const FVector& To, ERoadClass RoadClass, int32 Lanes = 2,
		bool bOneWay = false, float SpeedLimit = 1390.f);

	/** Nœud le plus proche d'une position, dans un rayon donné (-1 si aucun). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	int32 FindNearestNode(const FVector& WorldLocation, float MaxRadius = 4000.f) const;

	/** A* : renvoie la liste des nœuds traversés (vide si aucun chemin). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	bool FindPath(int32 StartNode, int32 GoalNode, ERouteMode Mode, TArray<int32>& OutNodes) const;

	/** Ferme/ouvre un tronçon (travaux, accident). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	void SetEdgeClosed(int32 EdgeIndex, bool bClosed);

	/** Déclare un bouchon (0 = fluide, 1 = bloqué). */
	UFUNCTION(BlueprintCallable, Category = "Réseau")
	void SetEdgeCongestion(int32 EdgeIndex, float Congestion);

	// --- Accès --------------------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Réseau")
	int32 GetNodeCount() const { return Nodes.Num(); }

	UFUNCTION(BlueprintPure, Category = "Réseau")
	int32 GetEdgeCount() const { return Edges.Num(); }

	const FRoadNode& GetNode(int32 Index) const { return Nodes[Index]; }
	const FRoadEdge& GetEdge(int32 Index) const { return Edges[Index]; }

	/** Position monde d'un point situé à `Alpha` [0..1] le long de l'arête. */
	UFUNCTION(BlueprintPure, Category = "Réseau")
	FVector GetEdgePoint(int32 EdgeIndex, float Alpha) const;

	/** Tous les tronçons sortant d'un nœud. */
	UFUNCTION(BlueprintPure, Category = "Réseau")
	TArray<int32> GetOutgoingEdges(int32 NodeIndex) const;

	UPROPERTY(BlueprintAssignable, Category = "Réseau")
	FRoadNetworkChanged OnNetworkChanged;

private:
	UPROPERTY()
	TArray<FRoadNode> Nodes;

	UPROPERTY()
	TArray<FRoadEdge> Edges;

	/** Arêtes sortantes par nœud (doublons volontaires : accès O(1)). */
	TArray<TArray<int32>> OutgoingByNode;

	/** Index spatial : clé = cellule de grille, valeur = nœuds. */
	TMap<FIntPoint, TArray<int32>> SpatialHash;
	float CellSize = 6400.f;

	/** Heure de jeu utilisée pour les feux (0..24). */
	float ClockHours = 8.f;

	/** Horloge du cycle de feux (12 s rouge / 12 s vert, par nœud). */
	float SignalClock = 0.f;
	bool bSignalToggle = false;

	void RebuildOutgoing();
	void RebuildSpatialHash();
	FIntPoint CellOf(const FVector& Location) const;

	/** Coût d'une arête selon le mode (temps ou distance) + pénalités. */
	float EdgeCost(int32 EdgeIndex, ERouteMode Mode, float IncomingBearingDeg) const;

	static float BearingDeg(const FVector& From, const FVector& To);
};
