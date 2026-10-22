// ============================================================================
// METROPOLIS — MetropolisWorldBuilder.cpp
// ============================================================================
#include "MetropolisWorldBuilder.h"
#include "RoadNetworkSubsystem.h"
#include "StreetSurfaceActor.h"

#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "Components/StaticMeshComponent.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/CollisionProfile.h"

AMetropolisWorldBuilder::AMetropolisWorldBuilder()
{
	PrimaryActorTick.bCanEverTick = false;

	// Primitive moteur, toujours présente : /Engine/BasicShapes/Cube.
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeFinder(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (CubeFinder.Succeeded())
	{
		CubeMesh = CubeFinder.Object;
	}
}

void AMetropolisWorldBuilder::LoadMeshes()
{
	if (!CubeMesh)
	{
		CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	}
}

void AMetropolisWorldBuilder::SpawnBox(const FVector& Center, const FVector& HalfExtent, const FRotator& Rotation)
{
	UWorld* World = GetWorld();
	if (!World || !CubeMesh)
	{
		return;
	}

	// Un cube moteur mesure 100 cm : l'échelle = dimension / 100.
	const FVector Scale(
		FMath::Max(HalfExtent.X, 1.f) * 2.f / 100.f,
		FMath::Max(HalfExtent.Y, 1.f) * 2.f / 100.f,
		FMath::Max(HalfExtent.Z, 1.f) * 2.f / 100.f);

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	AStaticMeshActor* Box = World->SpawnActor<AStaticMeshActor>(
		AStaticMeshActor::StaticClass(), Center, Rotation, Params);
	if (!Box)
	{
		return;
	}

	// Un acteur créé après le BeginPlay doit être Movable, sinon Unreal
	// ignore silencieusement son transform (et log un avertissement).
	UStaticMeshComponent* Mesh = Box->GetStaticMeshComponent();
	Mesh->SetMobility(EComponentMobility::Movable);
	Box->SetActorScale3D(Scale);
	Mesh->SetStaticMesh(CubeMesh);
	Mesh->SetCollisionProfileName(UCollisionProfile::BlockAll_ProfileName);
	Mesh->SetCastShadow(true);
	++BoxesSpawned;
}

void AMetropolisWorldBuilder::BuildGround(const FBox2D& Bounds)
{
	const FVector2D Center = Bounds.GetCenter();
	const FVector2D Size = Bounds.GetSize();

	// Dalle de sol : 2 m d'épaisseur, dessus à Z = 0.
	SpawnBox(
		FVector(Center.X, Center.Y, -100.f),
		FVector(static_cast<float>(Size.X) * 0.5f + 4000.f,
			static_cast<float>(Size.Y) * 0.5f + 4000.f,
			100.f),
		FRotator::ZeroRotator);
}

void AMetropolisWorldBuilder::BuildRoads(URoadNetworkSubsystem* Network)
{
	if (!Network)
	{
		return;
	}

	for (int32 EdgeIndex = 0; EdgeIndex < Network->GetEdgeCount(); ++EdgeIndex)
	{
		const FRoadEdge& Edge = Network->GetEdge(EdgeIndex);
		const FVector A = Network->GetNode(Edge.From).Location;
		const FVector B = Network->GetNode(Edge.To).Location;
		const FVector Middle = (A + B) * 0.5f;
		const float Length = static_cast<float>(FVector::Dist2D(A, B));
		if (Length < 10.f)
		{
			continue;
		}

		const FRotator Rotation(0.f, (B - A).Rotation().Yaw, 0.f);

		// Chaussée : 4 cm d'épaisseur, dessus à Z = 0 (le sol est à -2 m).
		SpawnBox(
			FVector(Middle.X, Middle.Y, 2.f),
			FVector(Length * 0.5f, RoadWidth * 0.5f, 2.f),
			Rotation);
	}
}

void AMetropolisWorldBuilder::BuildSidewalks(URoadNetworkSubsystem* Network)
{
	UWorld* World = GetWorld();
	if (!World || !Network)
	{
		return;
	}

	// Un trottoir de chaque côté de chaque tronçon, décalé de RoadWidth/2.
	for (int32 EdgeIndex = 0; EdgeIndex < Network->GetEdgeCount(); ++EdgeIndex)
	{
		const FRoadEdge& Edge = Network->GetEdge(EdgeIndex);
		const FVector A = Network->GetNode(Edge.From).Location;
		const FVector B = Network->GetNode(Edge.To).Location;
		const float Length = static_cast<float>(FVector::Dist2D(A, B));
		if (Length < 10.f)
		{
			continue;
		}

		const FVector Direction = (B - A).GetSafeNormal2D();
		const FVector Right = FVector::CrossProduct(FVector::UpVector, Direction).GetSafeNormal2D();
		const FRotator Rotation(0.f, Direction.Rotation().Yaw, 0.f);
		const FVector Middle = (A + B) * 0.5f;

		for (const float Side : { -1.f, 1.f })
		{
			const FVector Location = Middle
				+ Right * Side * (RoadWidth * 0.5f + SidewalkWidth * 0.5f)
				+ FVector(0.f, 0.f, 4.f);

			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

			AStreetSurfaceActor* Sidewalk = World->SpawnActor<AStreetSurfaceActor>(
				AStreetSurfaceActor::StaticClass(), Location, Rotation, Params);
			if (!Sidewalk)
			{
				continue;
			}
			// Le trottoir se construit en C++ (ProceduralMesh) : 15 cm, biseau 14 cm.
			Sidewalk->SurfaceType = EStreetSurfaceType::Sidewalk;
			Sidewalk->Length = Length;
			Sidewalk->Width = SidewalkWidth;
			Sidewalk->BuildGeometry();
		}
	}
}

void AMetropolisWorldBuilder::BuildBuildings(const FBox2D& Bounds, float BlockSpacing)
{
	// Un îlot bâti par cellule de la grille, en retrait de la chaussée.
	const float Half = BlockSpacing * 0.5f - (RoadWidth * 0.5f + SidewalkWidth + 200.f);
	if (Half < 300.f)
	{
		return;
	}

	for (double X = Bounds.Min.X + Half + 200.f; X < Bounds.Max.X - Half; X += BlockSpacing)
	{
		for (double Y = Bounds.Min.Y + Half + 200.f; Y < Bounds.Max.Y - Half; Y += BlockSpacing)
		{
			const int32 Count = Random.RandRange(1, 3);
			for (int32 Index = 0; Index < Count; ++Index)
			{
				const float Width = Half * Random.FRandRange(0.35f, 0.75f);
				const float Depth = Half * Random.FRandRange(0.35f, 0.75f);
				const float Height = Random.FRandRange(
					static_cast<float>(BuildingHeightRange.X),
					static_cast<float>(BuildingHeightRange.Y));


				const FVector Center(
					X + Random.FRandRange(-Half * 0.4f, Half * 0.4f),
					Y + Random.FRandRange(-Half * 0.4f, Half * 0.4f),
					Height * 0.5f);

				SpawnBox(Center, FVector(Width * 0.5f, Depth * 0.5f, Height * 0.5f),
					FRotator(0.f, Random.FRandRange(0.f, 90.f), 0.f));
			}
		}
	}
}

void AMetropolisWorldBuilder::BuildParkedCars(const FBox2D& Bounds, float BlockSpacing)
{
	// Voitures garées décoratives : de vrais véhicules Chaos exigent un
	// skeletal mesh + physics asset (étape 4 de la doc éditeur). Ici ce sont
	// des volumes, explicitement pas des véhicules simulés.
	if (ParkedCarsPerBlock <= 0)
	{
		return;
	}

	for (double X = Bounds.Min.X; X < Bounds.Max.X; X += BlockSpacing)
	{
		for (double Y = Bounds.Min.Y; Y < Bounds.Max.Y; Y += BlockSpacing)
		{
			for (int32 Index = 0; Index < ParkedCarsPerBlock; ++Index)
			{
				const FVector Center(
					X + Random.FRandRange(-BlockSpacing * 0.35f, BlockSpacing * 0.35f),
					Y + Random.FRandRange(-BlockSpacing * 0.35f, BlockSpacing * 0.35f),
					72.f);
				SpawnBox(Center, FVector(220.f, 90.f, 72.f),
					FRotator(0.f, Random.FRandRange(0.f, 360.f), 0.f));
			}
		}
	}
}

void AMetropolisWorldBuilder::BuildDistrict(URoadNetworkSubsystem* Network)
{
	LoadMeshes();
	Random.Initialize(Seed);
	BoxesSpawned = 0;

	if (!Network || Network->GetNodeCount() < 2)
	{
		UE_LOG(LogTemp, Warning, TEXT("[Quartier] Graphe routier vide : rien à construire."));
		return;
	}
	if (!CubeMesh)
	{
		UE_LOG(LogTemp, Error, TEXT("[Quartier] /Engine/BasicShapes/Cube introuvable : "
			"vérifier que le contenu moteur n'est pas exclu du cook."));
		return;
	}

	// Emprise du réseau.
	FBox2D Bounds(ForceInit);
	float Spacing = 0.f;
	for (int32 Index = 0; Index < Network->GetNodeCount(); ++Index)
	{
		Bounds += FVector2D(Network->GetNode(Index).Location);
	}
	// Espacement = plus petite distance entre deux nœuds voisins distincts.
	float MinDistance = TNumericLimits<float>::Max();
	for (int32 EdgeIndex = 0; EdgeIndex < Network->GetEdgeCount(); ++EdgeIndex)
	{
		const FRoadEdge& Edge = Network->GetEdge(EdgeIndex);
		if (Edge.Length > 10.f)
		{
			MinDistance = FMath::Min(MinDistance, Edge.Length);
		}
	}
	Spacing = (MinDistance < TNumericLimits<float>::Max()) ? MinDistance : 6400.f;

	BuildGround(Bounds);
	BuildRoads(Network);
	BuildSidewalks(Network);
	BuildBuildings(Bounds, Spacing);
	BuildParkedCars(Bounds, Spacing);

	UE_LOG(LogTemp, Log, TEXT("[Quartier] %d volumes construits (emprise %.0f x %.0f m)."),
		BoxesSpawned, Bounds.GetSize().X / 100.f, Bounds.GetSize().Y / 100.f);
}
