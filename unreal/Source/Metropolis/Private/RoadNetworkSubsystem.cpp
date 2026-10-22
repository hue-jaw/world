// ============================================================================
// METROPOLIS — RoadNetworkSubsystem.cpp
// Implémentation du graphe routier et de l'A*.
// ============================================================================
#include "RoadNetworkSubsystem.h"
#include "Algo/Reverse.h"
#include "Math/UnrealMathUtility.h"

namespace
{
	// Pénalité de virage, exprimée dans l'unité du coût (voir EdgeCost).
	constexpr float TurnPenaltySeconds = 3.5f;
	constexpr float TurnPenaltyMeters  = 35.f;
	// Vitesse "maximale plausible" pour l'heuristique (m/s).
	constexpr float MaxPlausibleSpeedCmS = 3000.f;
}

void URoadNetworkSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	Nodes.Reset();
	Edges.Reset();
	OutgoingByNode.Reset();
	SpatialHash.Reset();
}

void URoadNetworkSubsystem::Deinitialize()
{
	Nodes.Reset();
	Edges.Reset();
	OutgoingByNode.Reset();
	SpatialHash.Reset();
	Super::Deinitialize();
}

TStatId URoadNetworkSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(URoadNetworkSubsystem, STATGROUP_Tickables);
}

// ---------------------------------------------------------------------------
//                               CONSTRUCTION
// ---------------------------------------------------------------------------

int32 URoadNetworkSubsystem::AddRoad(const FVector& From, const FVector& To, ERoadClass RoadClass,
	int32 Lanes, bool bOneWay, float SpeedLimit)
{
	const FVector A(From.X, From.Y, 0.f);
	const FVector B(To.X, To.Y, 0.f);

	// Un nœud existant à moins de 50 cm est réutilisé (jonctions propres).
	auto FindOrAddNode = [this](const FVector& P) -> int32
	{
		for (int32 Index = 0; Index < Nodes.Num(); ++Index)
		{
			if (FVector::DistSquared2D(Nodes[Index].Location, P) < FMath::Square(50.f))
			{
				return Index;
			}
		}
		FRoadNode Node;
		Node.Location = P;
		return Nodes.Add(Node);
	};

	const int32 FromIndex = FindOrAddNode(A);
	const int32 ToIndex = FindOrAddNode(B);

	auto MakeEdge = [&](int32 F, int32 T)
	{
		FRoadEdge Edge;
		Edge.From = F;
		Edge.To = T;
		Edge.Length = static_cast<float>(FVector::Dist2D(Nodes[F].Location, Nodes[T].Location));
		Edge.SpeedLimit = SpeedLimit;
		Edge.Class = RoadClass;
		Edge.Lanes = FMath::Max(1, Lanes);
		// Un sens unique ne va que dans le sens From -> To.
		Edge.bOneWay = bOneWay && F == FromIndex;
		const int32 EdgeIndex = Edges.Add(Edge);
		Nodes[F].Outgoing.AddUnique(EdgeIndex);
		return EdgeIndex;
	};

	const int32 Forward = MakeEdge(FromIndex, ToIndex);
	if (!bOneWay)
	{
		MakeEdge(ToIndex, FromIndex);
	}

	RebuildOutgoing();
	RebuildSpatialHash();
	OnNetworkChanged.Broadcast();
	return Forward;
}

void URoadNetworkSubsystem::BuildGrid(int32 SizeX, int32 SizeY, float Spacing, float SpeedLimit)
{
	Nodes.Reset();
	Edges.Reset();
	CellSize = FMath::Max(Spacing, 100.f);

	const int32 X = FMath::Clamp(SizeX, 2, 64);
	const int32 Y = FMath::Clamp(SizeY, 2, 64);

	TArray<int32> Index;
	Index.SetNum(X * Y);

	for (int32 Iy = 0; Iy < Y; ++Iy)
	{
		for (int32 Ix = 0; Ix < X; ++Ix)
		{
			FRoadNode Node;
			Node.Location = FVector(Ix * Spacing, Iy * Spacing, 0.f);
			// Un carrefour sur trois a un feu : assez pour tester le trafic,
			// assez peu pour ne pas hacher la circulation.
			Node.bHasTrafficLight = (Ix % 3 == 0 && Iy % 3 == 0);
			Node.SignalPhase = Node.bHasTrafficLight ? static_cast<uint8>((Ix + Iy) % 2 == 0 ? 2 : 0) : 2;
			Index[Iy * X + Ix] = Nodes.Add(Node);
		}
	}

	auto Connect = [&](int32 A, int32 B, bool bOneWay)
	{
		FRoadEdge Edge;
		Edge.From = A;
		Edge.To = B;
		Edge.Length = static_cast<float>(FVector::Dist2D(Nodes[A].Location, Nodes[B].Location));
		Edge.SpeedLimit = SpeedLimit;
		Edge.Class = ERoadClass::Street;
		Edge.Lanes = 2;
		Edge.bOneWay = bOneWay;
		const int32 EdgeIndex = Edges.Add(Edge);
		Nodes[A].Outgoing.Add(EdgeIndex);

		if (!bOneWay)
		{
			FRoadEdge Back = Edge;
			Back.From = B;
			Back.To = A;
			const int32 BackIndex = Edges.Add(Back);
			Nodes[B].Outgoing.Add(BackIndex);
		}
	};

	for (int32 Iy = 0; Iy < Y; ++Iy)
	{
		for (int32 Ix = 0; Ix < X; ++Ix)
		{
			const int32 Current = Index[Iy * X + Ix];
			// Une rue sur deux est à sens unique, en alternance : la ville
			// n'est pas un quadrillage parfaitement symétrique.
			if (Ix + 1 < X)
			{
				const bool bOneWay = ((Iy + Ix) % 2 == 0);
				Connect(Current, Index[Iy * X + Ix + 1], bOneWay);
			}
			if (Iy + 1 < Y)
			{
				const bool bOneWay = ((Iy + Ix) % 2 == 1);
				Connect(Current, Index[(Iy + 1) * X + Ix], bOneWay);
			}
		}
	}

	RebuildOutgoing();
	RebuildSpatialHash();
	OnNetworkChanged.Broadcast();
}

void URoadNetworkSubsystem::RebuildOutgoing()
{
	OutgoingByNode.Reset();
	OutgoingByNode.SetNum(Nodes.Num());
	for (int32 EdgeIndex = 0; EdgeIndex < Edges.Num(); ++EdgeIndex)
	{
		const FRoadEdge& Edge = Edges[EdgeIndex];
		if (Nodes.IsValidIndex(Edge.From))
		{
			OutgoingByNode[Edge.From].AddUnique(EdgeIndex);
		}
	}
}

FIntPoint URoadNetworkSubsystem::CellOf(const FVector& Location) const
{
	const float SafeCell = FMath::Max(CellSize, 100.f);
	return FIntPoint(
		FMath::FloorToInt(Location.X / SafeCell),
		FMath::FloorToInt(Location.Y / SafeCell));
}

void URoadNetworkSubsystem::RebuildSpatialHash()
{
	SpatialHash.Reset();
	for (int32 Index = 0; Index < Nodes.Num(); ++Index)
	{
		SpatialHash.FindOrAdd(CellOf(Nodes[Index].Location)).Add(Index);
	}
}

// ---------------------------------------------------------------------------
//                                 REQUÊTES
// ---------------------------------------------------------------------------

int32 URoadNetworkSubsystem::FindNearestNode(const FVector& WorldLocation, float MaxRadius) const
{
	int32 BestNode = INDEX_NONE;
	float BestDistanceSq = FMath::Square(MaxRadius);
	const FIntPoint Center = CellOf(WorldLocation);

	// Rayon en cellules : on élargit progressivement tant qu'on n'a rien trouvé.
	const int32 MaxRing = FMath::CeilToInt(MaxRadius / FMath::Max(CellSize, 100.f)) + 1;
	for (int32 Ring = 0; Ring <= MaxRing; ++Ring)
	{
		for (int32 DX = -Ring; DX <= Ring; ++DX)
		{
			for (int32 DY = -Ring; DY <= Ring; ++DY)
			{
				// Seulement le périmètre du ring (le centre a déjà été testé).
				if (Ring > 0 && FMath::Abs(DX) != Ring && FMath::Abs(DY) != Ring)
				{
					continue;
				}
				const TArray<int32>* Cell = SpatialHash.Find(FIntPoint(Center.X + DX, Center.Y + DY));
				if (!Cell)
				{
					continue;
				}
				for (const int32 NodeIndex : *Cell)
				{
					const float DistSq = static_cast<float>(
						FVector::DistSquared2D(Nodes[NodeIndex].Location, WorldLocation));
					if (DistSq < BestDistanceSq)
					{
						BestDistanceSq = DistSq;
						BestNode = NodeIndex;
					}
				}
			}
		}
		if (BestNode != INDEX_NONE)
		{
			// Un ring supplémentaire garantit qu'aucun nœud plus proche n'existe
			// dans la cellule voisine.
			if (Ring >= 1)
			{
				break;
			}
		}
	}
	return BestNode;
}

float URoadNetworkSubsystem::BearingDeg(const FVector& From, const FVector& To)
{
	const FVector2D Delta(To.X - From.X, To.Y - From.Y);
	if (Delta.IsNearlyZero())
	{
		return 0.f;
	}
	// Cap "boussole" : 0 = +X (Est), 90 = +Y (Nord). Suffisant pour comparer
	// des directions entre elles (les écarts restent corrects).
	return FMath::RadiansToDegrees(FMath::Atan2(Delta.Y, Delta.X));
}

float URoadNetworkSubsystem::EdgeCost(int32 EdgeIndex, ERouteMode Mode, float IncomingBearingDeg) const
{
	if (!Edges.IsValidIndex(EdgeIndex))
	{
		return TNumericLimits<float>::Max();
	}
	const FRoadEdge& Edge = Edges[EdgeIndex];
	if (Edge.bClosed)
	{
		return TNumericLimits<float>::Max();
	}

	const float CongestionMultiplier = 1.f + FMath::Clamp(Edge.Congestion, 0.f, 1.f) * 3.f;

	float Cost;
	if (Mode == ERouteMode::Shortest)
	{
		Cost = Edge.Length / 100.f;                       // mètres
	}
	else
	{
		// Temps (s) : longueur / vitesse, ralentie par la congestion.
		const float Speed = FMath::Max(Edge.SpeedLimit * 0.55f, 60.f);
		Cost = (Edge.Length / Speed) * CongestionMultiplier;
	}

	// Pénalité de virage : tourner coûte toujours plus que continuer.
	if (IncomingBearingDeg > -900.f && Nodes.IsValidIndex(Edge.To) && Nodes.IsValidIndex(Edge.From))
	{
		const float OutBearing = BearingDeg(Nodes[Edge.From].Location, Nodes[Edge.To].Location);
		const float Delta = FMath::Abs(FMath::FindDeltaAngleDegrees(IncomingBearingDeg, OutBearing));
		if (Delta > 35.f)
		{
			Cost += (Mode == ERouteMode::Shortest ? TurnPenaltyMeters : TurnPenaltySeconds);
		}
	}
	return Cost;
}

bool URoadNetworkSubsystem::FindPath(int32 StartNode, int32 GoalNode, ERouteMode Mode, TArray<int32>& OutNodes) const
{
	OutNodes.Reset();
	if (!Nodes.IsValidIndex(StartNode) || !Nodes.IsValidIndex(GoalNode))
	{
		return false;
	}
	if (StartNode == GoalNode)
	{
		OutNodes.Add(StartNode);
		return true;
	}

	const int32 NodeCount = Nodes.Num();
	TArray<float> CostSoFar;
	TArray<int32> CameFrom;
	TArray<float> BestBearing;
	CostSoFar.Init(TNumericLimits<float>::Max(), NodeCount);
	CameFrom.Init(INDEX_NONE, NodeCount);
	BestBearing.Init(-1000.f, NodeCount);

	// File de priorité : TPair compare (clé, valeur) — les doublons périmés
	// sont ignorés à la sortie (coût déjà meilleur trouvé).
	TArray<TPair<float, int32>> Open;
	Open.Heapify([](const TPair<float, int32>& A, const TPair<float, int32>& B)
	{
		return A.Key < B.Key;
	});

	auto Heuristic = [&](int32 NodeIndex) -> float
	{
		const float Dist = static_cast<float>(FVector::Dist2D(Nodes[NodeIndex].Location, Nodes[GoalNode].Location));
		return Mode == ERouteMode::Shortest
			? Dist / 100.f
			: Dist / MaxPlausibleSpeedCmS;
	};

	CostSoFar[StartNode] = 0.f;
	Open.HeapPush(TPair<float, int32>(Heuristic(StartNode), StartNode));

	while (Open.Num() > 0)
	{
		TPair<float, int32> Current;
		Open.HeapPop(Current, [](const TPair<float, int32>& A, const TPair<float, int32>& B)
		{
			return A.Key < B.Key;
		});

		const int32 NodeIndex = Current.Value;
		if (NodeIndex == GoalNode)
		{
			break;
		}

		const TArray<int32>* EdgesFromNode = OutgoingByNode.IsValidIndex(NodeIndex) ? &OutgoingByNode[NodeIndex] : nullptr;
		if (!EdgesFromNode)
		{
			continue;
		}

		for (const int32 EdgeIndex : *EdgesFromNode)
		{
			const FRoadEdge& Edge = Edges[EdgeIndex];
			const int32 Next = Edge.To;
			if (!Nodes.IsValidIndex(Next))
			{
				continue;
			}
			const float Step = EdgeCost(EdgeIndex, Mode, BestBearing[NodeIndex]);
			if (Step >= TNumericLimits<float>::Max())
			{
				continue;
			}
			const float NewCost = CostSoFar[NodeIndex] + Step;
			if (NewCost < CostSoFar[Next])
			{
				CostSoFar[Next] = NewCost;
				CameFrom[Next] = NodeIndex;
				BestBearing[Next] = BearingDeg(Nodes[NodeIndex].Location, Nodes[Next].Location);
				Open.HeapPush(TPair<float, int32>(NewCost + Heuristic(Next), Next));
			}
		}
	}

	if (CameFrom[GoalNode] == INDEX_NONE)
	{
		return false;   // pas de chemin (réseau coupé)
	}

	// Reconstruction depuis l'arrivée.
	int32 Cursor = GoalNode;
	while (Cursor != INDEX_NONE)
	{
		OutNodes.Add(Cursor);
		if (Cursor == StartNode)
		{
			break;
		}
		Cursor = CameFrom[Cursor];
	}
	Algo::Reverse(OutNodes);
	return OutNodes.Num() > 0 && OutNodes[0] == StartNode;
}

FVector URoadNetworkSubsystem::GetEdgePoint(int32 EdgeIndex, float Alpha) const
{
	if (!Edges.IsValidIndex(EdgeIndex))
	{
		return FVector::ZeroVector;
	}
	const FRoadEdge& Edge = Edges[EdgeIndex];
	if (!Nodes.IsValidIndex(Edge.From) || !Nodes.IsValidIndex(Edge.To))
	{
		return FVector::ZeroVector;
	}
	return FMath::Lerp(Nodes[Edge.From].Location, Nodes[Edge.To].Location, FMath::Clamp(Alpha, 0.f, 1.f));
}

TArray<int32> URoadNetworkSubsystem::GetOutgoingEdges(int32 NodeIndex) const
{
	return OutgoingByNode.IsValidIndex(NodeIndex) ? OutgoingByNode[NodeIndex] : TArray<int32>();
}

void URoadNetworkSubsystem::SetEdgeClosed(int32 EdgeIndex, bool bClosed)
{
	if (Edges.IsValidIndex(EdgeIndex) && Edges[EdgeIndex].bClosed != bClosed)
	{
		Edges[EdgeIndex].bClosed = bClosed;
		OnNetworkChanged.Broadcast();
	}
}

void URoadNetworkSubsystem::SetEdgeCongestion(int32 EdgeIndex, float Congestion)
{
	if (Edges.IsValidIndex(EdgeIndex))
	{
		Edges[EdgeIndex].Congestion = FMath::Clamp(Congestion, 0.f, 1.f);
	}
}

void URoadNetworkSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	// Horloge de jeu : 24 h en 40 minutes réelles (même règle que la v0.7).
	ClockHours = FMath::Fmod(ClockHours + DeltaTime * (24.f / (40.f * 60.f)), 24.f);

	// Feux : cycle rouge 12 s / vert 12 s, décalé par nœud.
	SignalClock += DeltaTime;
	if (SignalClock >= 12.f)
	{
		SignalClock = 0.f;
		bSignalToggle = !bSignalToggle;
		for (FRoadNode& Node : Nodes)
		{
			if (Node.bHasTrafficLight)
			{
				Node.SignalPhase = bSignalToggle ? 2 : 0;
			}
		}
	}
}
