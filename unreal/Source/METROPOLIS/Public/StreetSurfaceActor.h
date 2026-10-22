// ============================================================================
// METROPOLIS — StreetSurfaceActor
// Trottoirs, bordures, terre-pleins et îlots : de la VRAIE géométrie.
//
// Exigence §11 : « un trottoir, ça se monte ». Concrètement :
//   • le revêtement a une hauteur réelle (15 cm trottoir, 16 cm terre-plein,
//     18 cm îlot) et une COLLISION ;
//   • le bord est CHANFRÉINÉ (biseau à 45°) : la roue trouve une rampe
//     physique, la suspension travaille, la voiture monte ;
//   • aucun mur invisible : la collision suit exactement le maillage ;
//   • chaque surface porte un Physical Material (Asphalt, Concrete, Grass…)
//     que le véhicule et les PNJ lisent pour leur adhérence.
//
// Le maillage est construit en C++ (ProceduralMeshComponent) : il est donc
// reproductible, versionnable en Git et vérifiable sans ouvrir l'éditeur.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "StreetSurfaceActor.generated.h"

class UProceduralMeshComponent;
class UPhysicalMaterial;
class UMaterialInterface;

UENUM(BlueprintType)
enum class EStreetSurfaceType : uint8
{
	Sidewalk    UMETA(DisplayName = "Trottoir (15 cm)"),
	Median      UMETA(DisplayName = "Terre-plein (16 cm)"),
	Island      UMETA(DisplayName = "Îlot (18 cm)"),
	Crossing    UMETA(DisplayName = "Passage piéton surélevé"),
};

UCLASS(BlueprintType)
class METROPOLIS_API AStreetSurfaceActor : public AActor
{
	GENERATED_BODY()

public:
	AStreetSurfaceActor();

	virtual void OnConstruction(const FTransform& Transform) override;
	virtual void BeginPlay() override;

	/** Construit la géométrie (appelé automatiquement, exposé pour les tests). */
	UFUNCTION(BlueprintCallable, Category = "Voirie")
	void BuildGeometry();

	/** Hauteur réelle du revêtement, en centimètres. */
	UFUNCTION(BlueprintPure, Category = "Voirie")
	float GetSurfaceHeight() const;

	UFUNCTION(BlueprintCallable, Category = "Voirie")
	void SetSurfaceType(EStreetSurfaceType NewType);

	UFUNCTION(BlueprintPure, Category = "Voirie")
	FName GetPhysicalSurfaceName() const;

	// --- Réglages -----------------------------------------------------------
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	EStreetSurfaceType SurfaceType = EStreetSurfaceType::Sidewalk;

	/** Longueur du tronçon (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	float Length = 3200.f;

	/** Largeur du revêtement (cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	float Width = 320.f;

	/** Largeur du biseau de bord (cm). 12 cm ≈ 45° pour 15 cm de haut. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	float BevelWidth = 14.f;

	/** Matériau de surface (asphalte/béton/herbe), assigné à la section. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	TObjectPtr<UMaterialInterface> SurfaceMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voirie")
	TObjectPtr<UPhysicalMaterial> SurfacePhysicalMaterial;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Voirie")
	TObjectPtr<UProceduralMeshComponent> Mesh;

private:
	void BuildPrismSection(const TArray<FVector>& BasePoints, float Height,
		TArray<FVector>& OutVertices, TArray<int32>& OutTriangles,
		TArray<FVector>& OutNormals, TArray<FVector2D>& OutUVs,
		TArray<FProcMeshTangent>& OutTangents) const;
};
