// ============================================================================
// METROPOLIS — StreetSurfaceActor.cpp
// ============================================================================
#include "StreetSurfaceActor.h"
#include "ProceduralMeshComponent.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "Materials/MaterialInterface.h"

AStreetSurfaceActor::AStreetSurfaceActor()
{
	PrimaryActorTick.bCanEverTick = false;

	Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("SurfaceMesh"));
	RootComponent = Mesh;

	// Collision COMPLEXE : la forme physique est exactement la forme visuelle.
	// C'est la garantie « aucun mur invisible » : pas de cube englobant.
	Mesh->bUseComplexAsSimpleCollision = true;
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Mesh->SetCollisionObjectType(ECC_WorldStatic);
	Mesh->SetCollisionResponseToAllChannels(ECR_Block);
	Mesh->SetGenerateOverlapEvents(false);
	Mesh->SetCastShadow(true);
}

void AStreetSurfaceActor::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	BuildGeometry();
}

void AStreetSurfaceActor::BeginPlay()
{
	Super::BeginPlay();
	if (Mesh && Mesh->GetNumSections() == 0)
	{
		BuildGeometry();
	}
}

void AStreetSurfaceActor::SetSurfaceType(EStreetSurfaceType NewType)
{
	SurfaceType = NewType;
	BuildGeometry();
}

float AStreetSurfaceActor::GetSurfaceHeight() const
{
	switch (SurfaceType)
	{
	case EStreetSurfaceType::Sidewalk: return 15.f;
	case EStreetSurfaceType::Median:   return 16.f;
	case EStreetSurfaceType::Island:   return 18.f;
	case EStreetSurfaceType::Crossing: return 10.f;
	}
	return 15.f;
}

FName AStreetSurfaceActor::GetPhysicalSurfaceName() const
{
	switch (SurfaceType)
	{
	case EStreetSurfaceType::Sidewalk: return TEXT("Concrete");
	case EStreetSurfaceType::Median:   return TEXT("Grass");
	case EStreetSurfaceType::Island:   return TEXT("Grass");
	case EStreetSurfaceType::Crossing: return TEXT("Asphalt");
	}
	return TEXT("Concrete");
}

void AStreetSurfaceActor::BuildGeometry()
{
	if (!Mesh)
	{
		return;
	}
	Mesh->ClearAllMeshSections();

	const float H = GetSurfaceHeight();
	const float HalfLength = Length * 0.5f;
	const float HalfWidth = Width * 0.5f;
	const float Bevel = FMath::Clamp(BevelWidth, 1.f, HalfWidth - 1.f);

	// Emprise au sol : rectangle, bords chanfreinés sur les deux longs côtés
	// (sur une longueur, le trottoir est bordé de trottoir, pas de vide).
	// Repère local : X = longueur, Y = largeur, Z = hauteur.
	TArray<FVector> Base;
	Base.Add(FVector(-HalfLength, -HalfWidth, 0.f));
	Base.Add(FVector(HalfLength, -HalfWidth, 0.f));
	Base.Add(FVector(HalfLength, HalfWidth, 0.f));
	Base.Add(FVector(-HalfLength, HalfWidth, 0.f));

	TArray<FVector> Inset;
	const float InsetWidth = HalfWidth - Bevel;
	Inset.Add(FVector(-HalfLength, -InsetWidth, H));
	Inset.Add(FVector(HalfLength, -InsetWidth, H));
	Inset.Add(FVector(HalfLength, InsetWidth, H));
	Inset.Add(FVector(-HalfLength, InsetWidth, H));

	TArray<FVector> Vertices;
	TArray<int32> Triangles;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	TArray<FProcMeshTangent> Tangents;

	auto AddQuad = [&](const FVector& A, const FVector& B, const FVector& C, const FVector& D, const FVector& Normal)
	{
		const int32 Start = Vertices.Num();
		Vertices.Append({ A, B, C, D });
		const FVector Tangent = (B - A).GetSafeNormal();
		for (int32 Index = 0; Index < 4; ++Index)
		{
			Normals.Add(Normal);
			Tangents.Add(FProcMeshTangent(Tangent, false));
		}
		UVs.Add(FVector2D(0.f, 0.f));
		UVs.Add(FVector2D(1.f, 0.f));
		UVs.Add(FVector2D(1.f, 1.f));
		UVs.Add(FVector2D(0.f, 1.f));
		Triangles.Append({ Start + 0, Start + 1, Start + 2, Start + 0, Start + 2, Start + 3 });
	};

	// Dessus (le trottoir lui-même).
	AddQuad(Inset[3], Inset[2], Inset[1], Inset[0], FVector::UpVector);

	// Biseaux latéraux : c'est la rampe que la roue escalade.
	// Côté -Y
	AddQuad(Base[0], Base[1], Inset[1], Inset[0],
		FVector(0.f, -1.f, 1.f).GetSafeNormal());
	// Côté +Y
	AddQuad(Inset[3], Inset[2], Base[2], Base[3],
		FVector(0.f, 1.f, 1.f).GetSafeNormal());

	// Extrémités (biseau longitudinal, pour ne pas créer de marche frontale).
	{
		// -X
		const FVector N(-1.f, 0.f, 1.f);
		AddQuad(Base[3], Base[0], Inset[0], Inset[3], N.GetSafeNormal());
		// +X
		const FVector N2(1.f, 0.f, 1.f);
		AddQuad(Base[1], Base[2], Inset[2], Inset[1], N2.GetSafeNormal());
	}

	Mesh->CreateMeshSection_LinearColor(0, Vertices, Triangles, Normals, UVs, TArray<FLinearColor>(),
		Tangents, /*bCreateCollision=*/true);

	if (SurfaceMaterial)
	{
		Mesh->SetMaterial(0, SurfaceMaterial);
	}

	if (SurfacePhysicalMaterial)
	{
		Mesh->SetPhysMaterialOverride(SurfacePhysicalMaterial);
	}

	// Profil de collision dédié : solide, mais identifié comme voirie pour que
	// les requêtes de surface (véhicule, PNJ) puissent le distinguer.
	Mesh->SetCollisionProfileName(TEXT("BlockAll"));
}

void AStreetSurfaceActor::BuildPrismSection(const TArray<FVector>& BasePoints, float Height,
	TArray<FVector>& OutVertices, TArray<int32>& OutTriangles,
	TArray<FVector>& OutNormals, TArray<FVector2D>& OutUVs,
	TArray<FProcMeshTangent>& OutTangents) const
{
	// Utilitaire conservé pour les surfaces polygonales (giratoires, terre-pleins
	// centraux courbes) : extrusion d'un polygone fermé. Non utilisé par le
	// rectangle ci-dessus, mais prêt pour les Blueprints de quartier.
	const int32 Count = BasePoints.Num();
	if (Count < 3)
	{
		return;
	}

	const FVector Up = FVector::UpVector;
	const int32 TopStart = OutVertices.Num();
	for (const FVector& Point : BasePoints)
	{
		OutVertices.Add(Point + FVector(0.f, 0.f, Height));
		OutNormals.Add(Up);
		OutUVs.Add(FVector2D(Point.X / 100.f, Point.Y / 100.f));
		OutTangents.Add(FProcMeshTangent(FVector::ForwardVector, false));
	}
	for (int32 Index = 1; Index < Count - 1; ++Index)
	{
		OutTriangles.Append({ TopStart, TopStart + Index, TopStart + Index + 1 });
	}

	for (int32 Index = 0; Index < Count; ++Index)
	{
		const FVector& A = BasePoints[Index];
		const FVector& B = BasePoints[(Index + 1) % Count];
		const int32 Start = OutVertices.Num();
		OutVertices.Append({ A, B, B + FVector(0.f, 0.f, Height), A + FVector(0.f, 0.f, Height) });
		const FVector Side = (B - A).GetSafeNormal();
		const FVector Normal = FVector::CrossProduct(Side, Up).GetSafeNormal();
		for (int32 Vertex = 0; Vertex < 4; ++Vertex)
		{
			OutNormals.Add(Normal);
			OutTangents.Add(FProcMeshTangent(Side, false));
		}
		OutUVs.Add(FVector2D(0.f, 0.f));
		OutUVs.Add(FVector2D(1.f, 0.f));
		OutUVs.Add(FVector2D(1.f, 1.f));
		OutUVs.Add(FVector2D(0.f, 1.f));
		OutTriangles.Append({ Start, Start + 1, Start + 2, Start, Start + 2, Start + 3 });
	}
}
